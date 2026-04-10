from __future__ import annotations


def test_recompute_batch_counts_keeps_batch_active_when_mixed_results_still_have_running_jobs(app_modules) -> None:
    store = app_modules["store"]
    store.bootstrap_schema()

    batch, _ = store.create_batch_and_jobs(
        {
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "requested_outputs": 3,
        },
        [
            {"job_id": "job-1", "status": "completed", "model_key": "nano-banana-2"},
            {"job_id": "job-2", "status": "failed", "model_key": "nano-banana-2"},
            {"job_id": "job-3", "status": "running", "model_key": "nano-banana-2"},
        ],
    )

    recomputed = store.recompute_batch_counts(batch["batch_id"])

    assert recomputed["status"] == "processing"
    assert recomputed["completed_count"] == 1
    assert recomputed["failed_count"] == 1
    assert recomputed["running_count"] == 1


def test_recompute_batch_counts_marks_partial_failure_only_after_all_jobs_settle(app_modules) -> None:
    store = app_modules["store"]
    store.bootstrap_schema()

    batch, _ = store.create_batch_and_jobs(
        {
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "requested_outputs": 2,
        },
        [
            {"job_id": "job-a", "status": "completed", "model_key": "nano-banana-2"},
            {"job_id": "job-b", "status": "failed", "model_key": "nano-banana-2"},
        ],
    )

    recomputed = store.recompute_batch_counts(batch["batch_id"])

    assert recomputed["status"] == "partial_failure"
    assert recomputed["completed_count"] == 1
    assert recomputed["failed_count"] == 1
