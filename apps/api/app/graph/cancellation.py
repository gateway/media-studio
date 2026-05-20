from __future__ import annotations

from typing import Dict, List

from .. import store


GRAPH_RUN_CANCELLED_MESSAGE = "Graph run cancelled."
_CANCELLABLE_JOB_STATUSES = {"queued", "submitted", "running"}


def cancel_batch_jobs(batch_id: str) -> Dict[str, List[str]]:
    cancelled_job_ids: List[str] = []
    for job in store.list_jobs_for_batches([batch_id], include_dismissed=True):
        job_id = str(job.get("job_id") or "").strip()
        if not job_id or str(job.get("status") or "").strip() not in _CANCELLABLE_JOB_STATUSES:
            continue
        store.update_job(job_id, {"status": "cancelled", "finished_at": store.utcnow_iso()})
        store.append_job_event(job_id, "cancelled", {"batch_id": batch_id})
        cancelled_job_ids.append(job_id)
    if cancelled_job_ids:
        store.recompute_batch_counts(batch_id)
    return {"batch_ids": [batch_id], "job_ids": cancelled_job_ids}


def cancel_kie_jobs_for_run(run_id: str) -> Dict[str, List[str]]:
    batch_ids: List[str] = []
    cancelled_job_ids: List[str] = []
    for event in store.list_graph_run_events(run_id):
        payload = event.get("payload_json") or {}
        batch_id = str(payload.get("batch_id") or "").strip()
        if not batch_id or batch_id in batch_ids:
            continue
        batch_ids.append(batch_id)
    for batch_id in batch_ids:
        result = cancel_batch_jobs(batch_id)
        cancelled_job_ids.extend([job_id for job_id in result.get("job_ids") or [] if job_id not in cancelled_job_ids])
    return {"batch_ids": batch_ids, "job_ids": cancelled_job_ids}
