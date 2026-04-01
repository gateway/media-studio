from __future__ import annotations

from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from . import kie_adapter, service, store
from .runner import runner
from .schemas import (
    AssetListResponse,
    AssetRecord,
    BatchRecord,
    BatchesListResponse,
    CreditsResponse,
    EnhancePreviewRequest,
    EnhancePreviewResponse,
    EnhancementConfigRecord,
    EnhancementProviderModel,
    EnhancementProviderProbeRequest,
    EnhancementProviderProbeResponse,
    EnhancementConfigUpsertRequest,
    HealthResponse,
    JobRecord,
    JobEventRecord,
    JobEventsResponse,
    JobSubmitRequest,
    JobsListResponse,
    ModelQueuePolicyResponse,
    ModelQueuePolicyUpdate,
    ModelSummary,
    PresetRecord,
    PresetUpsertRequest,
    PricingResponse,
    PromptContextRequest,
    PromptContextResponse,
    QueueSettingsResponse,
    QueueSettingsUpdate,
    SubmitResponse,
    SystemPromptRecord,
    SystemPromptUpsertRequest,
    ValidateRequest,
    ValidateResponse,
)
from .settings import settings


def _not_found(name: str) -> HTTPException:
    return HTTPException(status_code=404, detail="%s not found" % name)


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.data_root.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    settings.downloads_dir.mkdir(parents=True, exist_ok=True)
    settings.outputs_dir.mkdir(parents=True, exist_ok=True)
    store.bootstrap_schema()
    if settings.media_background_poll_enabled:
        runner.start()
    yield
    runner.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
settings.data_root.mkdir(parents=True, exist_ok=True)
app.mount("/media/files", StaticFiles(directory=settings.data_root, check_dir=False), name="media-files")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    pricing = kie_adapter.pricing_snapshot()
    queue_settings = store.get_queue_settings()
    issues: List[str] = []
    if queue_settings["queue_enabled"] and not runner.is_running():
        issues.append("Runner is not active while queue processing is enabled.")
    if runner.last_tick:
        try:
            last_tick = datetime.fromisoformat(runner.last_tick)
            max_age_seconds = max(10, settings.media_poll_seconds * 3)
            if datetime.now(timezone.utc) - last_tick > timedelta(seconds=max_age_seconds):
                issues.append("Runner heartbeat is stale.")
        except ValueError:
            issues.append("Runner heartbeat timestamp is invalid.")
    return HealthResponse(
        status="ok",
        app=settings.app_name,
        supervisor=settings.media_studio_supervisor,
        queue_enabled=queue_settings["queue_enabled"],
        queued_jobs=store.queued_job_count(),
        running_jobs=store.running_job_count(),
        last_scheduler_tick=runner.last_tick,
        pricing_source=pricing["source"],
        issues=issues,
    )


@app.get("/media/models", response_model=List[ModelSummary])  # type: ignore[name-defined]
def list_models():
    return [ModelSummary(**item) for item in kie_adapter.list_models()]


@app.get("/media/models/{model_key}", response_model=ModelSummary)
def get_model(model_key: str):
    try:
        return ModelSummary(**kie_adapter.get_model(model_key))
    except Exception:
        raise _not_found("model")


@app.get("/media/pricing", response_model=PricingResponse)
def get_pricing():
    return PricingResponse(**kie_adapter.pricing_snapshot())


@app.post("/media/pricing/refresh", response_model=PricingResponse)
def refresh_pricing():
    return PricingResponse(**kie_adapter.refresh_pricing_snapshot())


@app.get("/media/credits", response_model=CreditsResponse)
def get_credits():
    payload = kie_adapter.get_credit_balance()
    return CreditsResponse(available_credits=payload.get("available_credits"), raw=payload)


@app.get("/media/queue/settings", response_model=QueueSettingsResponse)
def get_queue_settings():
    return QueueSettingsResponse(**store.get_queue_settings())


@app.patch("/media/queue/settings", response_model=QueueSettingsResponse)
def patch_queue_settings(payload: QueueSettingsUpdate):
    return QueueSettingsResponse(**store.update_queue_settings(payload.model_dump()))


@app.get("/media/queue/policies", response_model=List[ModelQueuePolicyResponse])  # type: ignore[name-defined]
def list_queue_policies():
    return [ModelQueuePolicyResponse(**item) for item in store.list_model_queue_policies()]


@app.patch("/media/queue/policies/{model_key}", response_model=ModelQueuePolicyResponse)
def patch_queue_policy(model_key: str, payload: ModelQueuePolicyUpdate):
    return ModelQueuePolicyResponse(**store.upsert_model_queue_policy(model_key, payload.model_dump()))


@app.get("/media/presets", response_model=List[PresetRecord])  # type: ignore[name-defined]
def list_presets():
    return [PresetRecord(**item) for item in store.list_presets()]


@app.get("/media/presets/{preset_id}", response_model=PresetRecord)
def get_preset(preset_id: str):
    record = store.get_preset(preset_id)
    if not record:
        raise _not_found("preset")
    return PresetRecord(**record)


@app.post("/media/presets", response_model=PresetRecord)
def create_preset(payload: PresetUpsertRequest):
    try:
        return PresetRecord(**service.upsert_preset(payload))
    except service.ServiceError as exc:
        raise _bad_request(str(exc))


@app.patch("/media/presets/{preset_id}", response_model=PresetRecord)
def update_preset(preset_id: str, payload: PresetUpsertRequest):
    try:
        return PresetRecord(**service.upsert_preset(payload, preset_id))
    except service.ServiceError as exc:
        raise _bad_request(str(exc))


@app.delete("/media/presets/{preset_id}")
def delete_preset(preset_id: str):
    try:
        return PresetRecord(**store.delete_preset(preset_id))
    except FileNotFoundError:
        raise _not_found("preset")


@app.get("/media/system-prompts", response_model=List[SystemPromptRecord])  # type: ignore[name-defined]
def list_system_prompts():
    return [SystemPromptRecord(**item) for item in store.list_system_prompts()]


@app.get("/media/system-prompts/lookup")
def system_prompt_lookup():
    return {"items": store.list_system_prompts()}


@app.get("/media/system-prompts/{prompt_id}", response_model=SystemPromptRecord)
def get_system_prompt(prompt_id: str):
    record = store.get_system_prompt(prompt_id)
    if not record:
        raise _not_found("system prompt")
    return SystemPromptRecord(**record)


@app.post("/media/system-prompts", response_model=SystemPromptRecord)
def create_system_prompt(payload: SystemPromptUpsertRequest):
    return SystemPromptRecord(**service.upsert_system_prompt(payload))


@app.patch("/media/system-prompts/{prompt_id}", response_model=SystemPromptRecord)
def update_system_prompt(prompt_id: str, payload: SystemPromptUpsertRequest):
    return SystemPromptRecord(**service.upsert_system_prompt(payload, prompt_id))


@app.delete("/media/system-prompts/{prompt_id}")
def delete_system_prompt(prompt_id: str):
    store.delete_system_prompt(prompt_id)
    return {"ok": True}


@app.get("/media/enhancement-configs", response_model=List[EnhancementConfigRecord])  # type: ignore[name-defined]
def list_enhancement_configs():
    return [EnhancementConfigRecord(**item) for item in store.list_enhancement_configs()]


@app.get("/media/enhancement-configs/{model_key}", response_model=EnhancementConfigRecord)
def get_enhancement_config(model_key: str):
    record = store.get_enhancement_config(model_key)
    if not record:
        raise _not_found("enhancement config")
    return EnhancementConfigRecord(**record)


@app.post("/media/enhancement-configs", response_model=EnhancementConfigRecord)
def create_enhancement_config(payload: EnhancementConfigUpsertRequest):
    return EnhancementConfigRecord(**service.upsert_enhancement_config(payload.model_dump()))


@app.patch("/media/enhancement-configs/{model_key}", response_model=EnhancementConfigRecord)
def update_enhancement_config(model_key: str, payload: EnhancementConfigUpsertRequest):
    return EnhancementConfigRecord(**service.upsert_enhancement_config(payload.model_dump(), model_key))


@app.delete("/media/enhancement-configs/{model_key}")
def delete_enhancement_config(model_key: str):
    store.delete_enhancement_config(model_key)
    return {"ok": True}


@app.post("/media/enhancement/providers/probe", response_model=EnhancementProviderProbeResponse)
def probe_enhancement_provider(payload: EnhancementProviderProbeRequest):
    try:
        bundle = service.probe_enhancement_provider(payload.model_dump())
        selected_model = bundle.get("selected_model")
        available_models = bundle.get("available_models") or []
        return EnhancementProviderProbeResponse(
            ok=True,
            provider=str(bundle.get("provider")),
            credential_source=(str(bundle.get("credential_source")) if bundle.get("credential_source") else None),
            selected_model=EnhancementProviderModel(**selected_model) if selected_model else None,
            available_models=[EnhancementProviderModel(**item) for item in available_models],
        )
    except service.ServiceError as exc:
        raise _bad_request(str(exc))


@app.post("/media/prompt-context", response_model=PromptContextResponse)
def get_prompt_context(payload: PromptContextRequest):
    try:
        bundle = service.build_validation_bundle(ValidateRequest(**payload.model_dump()))
        return PromptContextResponse(prompt_context=bundle["prompt_context"])
    except service.ServiceError as exc:
        raise _bad_request(str(exc))


@app.post("/media/validate", response_model=ValidateResponse)
def validate_request(payload: ValidateRequest):
    try:
        bundle = service.build_validation_bundle(payload)
        return ValidateResponse(
            prompt_context=bundle["prompt_context"],
            validation=bundle["validation"],
            preflight=bundle["preflight"],
            final_prompt=bundle["final_prompt"],
            resolved_options=bundle["resolved_options"],
        )
    except service.ServiceError as exc:
        raise _bad_request(str(exc))


@app.post("/media/enhance/preview", response_model=EnhancePreviewResponse)
def enhance_preview(payload: EnhancePreviewRequest):
    try:
        bundle = service.build_enhancement_preview(payload)
        return EnhancePreviewResponse(**bundle)
    except service.ServiceError as exc:
        raise _bad_request(str(exc))


@app.post("/media/jobs", response_model=SubmitResponse)
def submit_jobs(payload: JobSubmitRequest):
    try:
        batch, jobs = service.submit_jobs(payload)
        return SubmitResponse(
            batch=BatchRecord(**batch),
            jobs=[JobRecord(**job) for job in jobs],
        )
    except service.ServiceError as exc:
        raise _bad_request(str(exc))


@app.get("/media/jobs", response_model=JobsListResponse)
def list_jobs(limit: int = Query(default=200, le=500)):
    return JobsListResponse(items=[JobRecord(**item) for item in store.list_jobs(limit=limit)])


@app.get("/media/jobs/{job_id}", response_model=JobRecord)
def get_job(job_id: str):
    job = store.get_job(job_id)
    if not job:
        raise _not_found("job")
    return JobRecord(**job)


@app.get("/media/jobs/{job_id}/events", response_model=JobEventsResponse)
def get_job_events(job_id: str):
    job = store.get_job(job_id)
    if not job:
        raise _not_found("job")
    return JobEventsResponse(items=[JobEventRecord(**item) for item in store.list_job_events(job_id)])


@app.post("/media/jobs/{job_id}/poll", response_model=JobRecord)
def poll_job(job_id: str):
    job = store.get_job(job_id)
    if not job:
        raise _not_found("job")
    runner._poll_job(job)
    return JobRecord(**store.get_job(job_id))


@app.post("/media/jobs/{job_id}/retry", response_model=SubmitResponse)
def retry_job(job_id: str):
    job = store.get_job(job_id)
    if not job:
        raise _not_found("job")
    batch_request = job["normalized_request_json"] or {}
    payload = JobSubmitRequest(
        model_key=job["model_key"],
        task_mode=job.get("task_mode"),
        prompt=job.get("raw_prompt"),
        options=job.get("resolved_options_json") or {},
        output_count=1,
    )
    batch, jobs = service.submit_jobs(payload)
    return SubmitResponse(batch=BatchRecord(**batch), jobs=[JobRecord(**item) for item in jobs])


@app.post("/media/jobs/{job_id}/dismiss", response_model=JobRecord)
def dismiss_job(job_id: str):
    return JobRecord(**store.mark_job_dismissed(job_id))


@app.get("/media/batches", response_model=BatchesListResponse)
def list_batches(limit: int = Query(default=100, le=500)):
    return BatchesListResponse(items=[BatchRecord(**item) for item in store.list_batches(limit=limit)])


@app.get("/media/batches/{batch_id}", response_model=BatchRecord)
def get_batch(batch_id: str):
    batch = store.get_batch(batch_id)
    if not batch:
        raise _not_found("batch")
    return BatchRecord(**batch)


@app.post("/media/batches/{batch_id}/cancel", response_model=BatchRecord)
def cancel_batch(batch_id: str):
    batch = store.get_batch(batch_id)
    if not batch:
        raise _not_found("batch")
    for job in store.list_jobs(include_dismissed=True):
        if job["batch_id"] == batch_id and job["status"] in ("queued", "submitted", "running"):
            store.update_job(job["job_id"], {"status": "cancelled", "finished_at": store.utcnow_iso()})
            store.append_job_event(job["job_id"], "cancelled", {"batch_id": batch_id})
    return BatchRecord(**store.recompute_batch_counts(batch_id))


@app.get("/media/assets", response_model=AssetListResponse)
def list_assets(
    limit: int = Query(default=50, le=200),
    cursor: Optional[str] = None,
    favorites: bool = False,
    media_type: Optional[str] = Query(default=None, pattern="^(image|video)?$"),
):
    rows = store.list_assets(limit=limit + 1, cursor=cursor, favorites_only=favorites, media_type=media_type)
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [AssetRecord(**item) for item in rows]
    next_cursor = items[-1].created_at if has_more and items else None
    return AssetListResponse(items=items, next_cursor=next_cursor)


@app.get("/media/assets/latest")
def latest_assets():
    return {"items": store.list_assets(limit=12)}


@app.get("/media/assets/{asset_id}", response_model=AssetRecord)
def get_asset(asset_id: str):
    asset = store.get_asset(asset_id)
    if not asset:
        raise _not_found("asset")
    return AssetRecord(**asset)


@app.post("/media/assets/{asset_id}/dismiss", response_model=AssetRecord)
def dismiss_asset(asset_id: str):
    return AssetRecord(**store.mark_asset_dismissed(asset_id))


@app.post("/media/assets/{asset_id}/favorite", response_model=AssetRecord)
def favorite_asset(asset_id: str, favorited: bool = True):
    return AssetRecord(**store.mark_asset_favorite(asset_id, favorited))


@app.post("/media/providers/kie/callback")
def kie_callback(payload: dict):
    task_id = payload.get("task_id") or payload.get("taskId")
    if not task_id:
        return {"ok": False, "reason": "missing task_id"}
    for job in store.list_jobs(include_dismissed=True):
        if job.get("provider_task_id") == task_id:
            store.update_job(job["job_id"], {"final_status_json": payload})
            store.append_job_event(job["job_id"], "provider_callback", payload)
            return {"ok": True}
    return {"ok": False, "reason": "unknown task_id"}
