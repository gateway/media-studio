from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, Optional

from . import kie_adapter, service, store
from .settings import settings

logger = logging.getLogger(__name__)


class MediaRunner:
    display_name = "Media Studio Runner"
    thread_name = "media-studio-runner"
    mode = "embedded"
    attached_to = "Media Studio API"

    def __init__(self) -> None:
        self._thread = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._job_lock_guard = threading.Lock()
        self._job_locks: dict[str, threading.Lock] = {}
        self.last_tick = None

    def _job_lock(self, job_id: str) -> threading.Lock:
        with self._job_lock_guard:
            lock = self._job_locks.get(job_id)
            if lock is None:
                lock = threading.Lock()
                self._job_locks[job_id] = lock
            return lock

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self.reconcile()
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name=self.thread_name, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def is_running(self) -> bool:
        return bool(self._thread and self._thread.is_alive() and not self._stop.is_set())

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception:
                logger.exception("media runner tick failed")
            self._stop.wait(max(1, settings.media_poll_seconds))

    def reconcile(self) -> None:
        store.deduplicate_assets_by_job_id()
        store.repair_queue_positions()
        store.reset_invalid_active_jobs()
        for job in store.active_jobs():
            self._recover_terminal_job(job)
        for batch_id in store.open_batch_ids():
            store.recompute_batch_counts(batch_id)

    def tick(self) -> None:
        with self._lock:
            self.last_tick = store.utcnow_iso()
            settings_payload = store.get_queue_settings()
            if not settings_payload["queue_enabled"]:
                return
            active_count = store.running_job_count()
            capacity = max(0, settings_payload["max_concurrent_jobs"] - active_count)
            if capacity:
                for job in store.queued_jobs(capacity):
                    self._start_job(job)
            for job in store.active_jobs():
                self.poll_job_once(job)

    def poll_job_once(self, job: Dict[str, Any]) -> None:
        self._poll_job(job)

    def _start_job(self, job: Dict[str, Any]) -> None:
        if job.get("provider_task_id"):
            repaired = store.update_job(
                job["job_id"],
                {
                    "status": "running",
                    "last_polled_at": store.utcnow_iso(),
                    "error": None,
                },
            )
            store.append_job_event(repaired["job_id"], "resumed_existing_provider_task", {"provider_task_id": repaired["provider_task_id"]})
            store.recompute_batch_counts(repaired["batch_id"])
            return
        store.append_job_event(job["job_id"], "scheduler_start_attempt", {"attempts": job["scheduler_attempts"] + 1})
        updated = store.update_job(
            job["job_id"],
            {"status": "submitted", "scheduler_attempts": job["scheduler_attempts"] + 1, "started_at": store.utcnow_iso()},
        )
        store.recompute_batch_counts(updated["batch_id"])
        if not settings.media_enable_live_submit or not settings.kie_api_key:
            store.update_job(updated["job_id"], {"status": "running", "last_polled_at": store.utcnow_iso()})
            self._complete_offline_job(updated)
            return
        prepared: Optional[Dict[str, Any]] = None
        try:
            prepared = kie_adapter.prepare_request_for_submission(updated["normalized_request_json"])
            updated = store.update_job(updated["job_id"], {"prepared_json": prepared})
            submission = kie_adapter.submit_request(prepared)
            updated = store.update_job(
                updated["job_id"],
                {
                    "status": "running",
                    "submit_response_json": submission,
                    "provider_task_id": submission.get("task_id"),
                    "last_polled_at": store.utcnow_iso(),
                },
            )
            store.append_job_event(updated["job_id"], "submitted", {"provider_task_id": updated.get("provider_task_id")})
        except Exception as exc:
            logger.exception("media job submission failed", extra={"job_id": updated["job_id"]})
            self._requeue_or_fail(updated, str(exc))

    def _requeue_or_fail(self, job: Dict[str, Any], error: str) -> None:
        queue_settings = store.get_queue_settings()
        if job["scheduler_attempts"] < queue_settings["max_retry_attempts"]:
            repaired = store.update_job(
                job["job_id"],
                {"status": "queued", "error": error, "queue_position": store.queued_job_count() + 1},
            )
            store.append_job_event(repaired["job_id"], "requeued", {"error": error})
        else:
            failed = store.update_job(job["job_id"], {"status": "failed", "error": error, "finished_at": store.utcnow_iso()})
            store.append_job_event(failed["job_id"], "failed", {"error": error})
        store.recompute_batch_counts(job["batch_id"])

    def _complete_offline_job(self, job: Dict[str, Any]) -> None:
        asset = service.simulate_job_completion(job, settings.downloads_dir)
        completed = store.update_job(
            job["job_id"],
            {
                "status": "completed",
                "finished_at": store.utcnow_iso(),
                "final_status_json": {"state": "completed", "mode": "offline"},
            },
        )
        store.append_job_event(completed["job_id"], "completed", {"asset_id": asset["asset_id"], "mode": "offline"})
        store.recompute_batch_counts(completed["batch_id"])

    def _recover_terminal_job(self, job: Dict[str, Any]) -> None:
        status = job.get("final_status_json") or {}
        state = str(status.get("state") or "").lower()
        if state in {"succeeded", "completed", "failed"}:
            try:
                updated = self._finalize_job_from_status(job, status)
                store.recompute_batch_counts(updated["batch_id"])
            except Exception as exc:
                logger.exception("media job terminal recovery failed", extra={"job_id": job["job_id"]})
                updated = store.update_job(
                    job["job_id"],
                    {
                        "status": "running",
                        "error": "Recovery failed: %s" % exc,
                        "last_polled_at": store.utcnow_iso(),
                    },
                )
                store.append_job_event(updated["job_id"], "recovery_error", {"error": str(exc)})
                store.recompute_batch_counts(updated["batch_id"])

    def _finalize_job_from_status(self, job: Dict[str, Any], status: Dict[str, Any]) -> Dict[str, Any]:
        with self._job_lock(job["job_id"]):
            current = store.get_job(job["job_id"]) or job
            updated = store.update_job(current["job_id"], {"last_polled_at": store.utcnow_iso(), "final_status_json": status})
            state = str(status.get("state") or "").lower()
            if state in {"succeeded", "completed"}:
                if updated.get("status") == "completed" and updated.get("artifact_json"):
                    return store.update_job(
                        updated["job_id"],
                        {
                            "status": "completed",
                            "finished_at": updated.get("finished_at") or store.utcnow_iso(),
                            "error": None,
                        },
                    )
                output_urls = status.get("output_urls") or []
                if output_urls:
                    source_url = output_urls[0]
                    suffix = ".mp4" if ".mp4" in source_url.lower() else ".bin"
                    destination = settings.downloads_dir / f"{updated['job_id']}{suffix}"
                    kie_adapter.download_output_file(source_url, str(destination))
                    try:
                        asset = service.publish_job_artifact(updated, destination, source_url)
                        updated = store.update_job(updated["job_id"], {"status": "completed", "finished_at": store.utcnow_iso(), "error": None})
                        store.append_job_event(updated["job_id"], "completed", {"asset_id": asset["asset_id"]})
                    except Exception as exc:
                        logger.exception("media artifact publish failed", extra={"job_id": updated["job_id"]})
                        updated = store.update_job(
                            updated["job_id"],
                            {
                                "status": "running",
                                "error": "Artifact publish failed: %s" % exc,
                            },
                        )
                        store.append_job_event(updated["job_id"], "artifact_publish_retry", {"error": str(exc)})
                else:
                    updated = store.update_job(
                        updated["job_id"],
                        {"status": "failed", "error": "No output URLs returned.", "finished_at": store.utcnow_iso()},
                    )
                    store.append_job_event(updated["job_id"], "failed", {"error": "No output URLs returned."})
                return updated
            if state == "failed":
                updated = store.update_job(
                    updated["job_id"],
                    {"status": "failed", "error": status.get("error_message"), "finished_at": store.utcnow_iso()},
                )
                store.append_job_event(updated["job_id"], "failed", {"error": status.get("error_message")})
                return updated
            return updated

    def _poll_job(self, job: Dict[str, Any]) -> None:
        if not settings.media_enable_live_submit or not settings.kie_api_key:
            return
        if not job.get("provider_task_id"):
            repaired = store.update_job(job["job_id"], {"status": "queued", "queue_position": store.queued_job_count() + 1})
            store.append_job_event(repaired["job_id"], "repaired_to_queue", {"reason": "missing provider_task_id"})
            store.recompute_batch_counts(repaired["batch_id"])
            return
        try:
            status = kie_adapter.poll_task(job["provider_task_id"])
            updated = self._finalize_job_from_status(job, status)
            store.recompute_batch_counts(updated["batch_id"])
        except Exception as exc:
            logger.exception("media job poll failed", extra={"job_id": job["job_id"], "provider_task_id": job.get("provider_task_id")})
            queue_settings = store.get_queue_settings()
            next_poll_error_count = store.count_job_events(job["job_id"], "poll_error") + 1
            error_message = "Poll failed: %s" % exc
            if next_poll_error_count >= queue_settings["max_retry_attempts"]:
                updated = store.update_job(
                    job["job_id"],
                    {
                        "status": "failed",
                        "error": error_message,
                        "finished_at": store.utcnow_iso(),
                        "last_polled_at": store.utcnow_iso(),
                    },
                )
                store.append_job_event(
                    updated["job_id"],
                    "failed",
                    {"error": str(exc), "reason": "poll_error_retry_limit", "poll_error_count": next_poll_error_count},
                )
            else:
                updated = store.update_job(
                    job["job_id"],
                    {
                        "status": "running",
                        "error": error_message,
                        "last_polled_at": store.utcnow_iso(),
                    },
                )
                store.append_job_event(
                    updated["job_id"],
                    "poll_error",
                    {"error": str(exc), "poll_error_count": next_poll_error_count},
                )
            store.recompute_batch_counts(updated["batch_id"])


runner = MediaRunner()
