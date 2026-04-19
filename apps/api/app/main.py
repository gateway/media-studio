from __future__ import annotations

from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import kie_adapter, service, store
from .control_auth import validate_control_request
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
    FavoriteAssetRequest,
    HealthResponse,
    JobRecord,
    JobEventRecord,
    JobEventsResponse,
    JobSubmitRequest,
    JobsListResponse,
    ModelQueuePolicyResponse,
    ModelQueuePolicyUpdate,
    ModelSummary,
    ProjectListResponse,
    ProjectRecord,
    ProjectUpsertRequest,
    PresetRecord,
    PresetUpsertRequest,
    PricingResponse,
    PricingEstimateResponse,
    PromptContextRequest,
    PromptContextResponse,
    QueueSettingsResponse,
    QueueSettingsUpdate,
    ReferenceMediaListResponse,
    ReferenceMediaRecord,
    ReferenceMediaRegisterRequest,
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


@app.middleware("http")
async def enforce_control_access(request: Request, call_next):
    blocked = validate_control_request(request)
    if blocked is not None:
        return blocked
    return await call_next(request)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    pricing = kie_adapter.pricing_snapshot()
    queue_settings = store.get_queue_settings()
    issues: List[str] = []
    runner_active = runner.is_running()
    max_age_seconds = max(10, settings.media_poll_seconds * 3)
    heartbeat_age_seconds: Optional[int] = None
    if queue_settings["queue_enabled"] and not runner_active:
        issues.append("Runner is not active while queue processing is enabled.")
    if runner.last_tick:
        try:
            last_tick = datetime.fromisoformat(runner.last_tick)
            heartbeat_age_seconds = max(0, int((datetime.now(timezone.utc) - last_tick).total_seconds()))
            if heartbeat_age_seconds > max_age_seconds:
                issues.append("Runner heartbeat is stale.")
        except ValueError:
            issues.append("Runner heartbeat timestamp is invalid.")
    runner_health = "paused"
    if queue_settings["queue_enabled"]:
        runner_health = "healthy" if runner_active and not issues else "needs_attention"
    return HealthResponse(
        status="ok",
        app=settings.app_name,
        supervisor=settings.media_studio_supervisor,
        kie_api_repo_connected=bool(settings.kie_api_repo_path and settings.kie_api_repo_path.exists()),
        kie_api_key_configured=bool(settings.kie_api_key),
        live_submit_enabled=settings.media_enable_live_submit,
        openrouter_api_key_configured=bool(settings.openrouter_api_key),
        runner_name=runner.display_name,
        runner_mode=runner.mode,
        runner_attached_to=runner.attached_to,
        runner_process_name=runner.thread_name,
        runner_launch_mode="supervised" if settings.media_studio_supervisor else "manual",
        runner_active=runner_active,
        runner_health=runner_health,
        heartbeat_age_seconds=heartbeat_age_seconds,
        heartbeat_max_age_seconds=max_age_seconds,
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


@app.post("/media/pricing/estimate", response_model=PricingEstimateResponse)
def estimate_pricing(payload: ValidateRequest):
    try:
        bundle = service.build_validation_bundle(payload)
        return PricingEstimateResponse(
            prompt_context=bundle["prompt_context"],
            validation=bundle["validation"],
            preflight=bundle["preflight"],
            pricing_summary=bundle["pricing_summary"],
            final_prompt=bundle["final_prompt"],
            resolved_options=bundle["resolved_options"],
            warnings=bundle["preflight"].get("warnings") or [],
        )
    except service.ServiceError as exc:
        raise _bad_request(str(exc))


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


@app.get("/media/projects", response_model=ProjectListResponse)
def list_projects(status: Optional[str] = Query(default="active")):
    return ProjectListResponse(items=[ProjectRecord(**item) for item in store.list_projects(status=status)])


@app.get("/media/projects/{project_id}", response_model=ProjectRecord)
def get_project(project_id: str):
    record = store.get_project(project_id)
    if not record:
        raise _not_found("project")
    return ProjectRecord(**record)


@app.post("/media/projects", response_model=ProjectRecord)
def create_project(payload: ProjectUpsertRequest):
    try:
        return ProjectRecord(**service.upsert_project(payload))
    except service.ServiceError as exc:
        raise _bad_request(str(exc))


@app.patch("/media/projects/{project_id}", response_model=ProjectRecord)
def update_project(project_id: str, payload: ProjectUpsertRequest):
    try:
        return ProjectRecord(**service.upsert_project(payload, project_id))
    except service.ServiceError as exc:
        if "not found" in str(exc).lower():
            raise _not_found("project")
        raise _bad_request(str(exc))


@app.post("/media/projects/{project_id}/archive", response_model=ProjectRecord)
def archive_project(project_id: str):
    try:
        return ProjectRecord(**service.archive_project(project_id))
    except service.ServiceError:
        raise _not_found("project")


@app.post("/media/projects/{project_id}/unarchive", response_model=ProjectRecord)
def unarchive_project(project_id: str):
    try:
        return ProjectRecord(**service.unarchive_project(project_id))
    except service.ServiceError:
        raise _not_found("project")


@app.delete("/media/projects/{project_id}")
def delete_project(project_id: str, permanent: bool = Query(default=False)):
    try:
        record = service.delete_project(project_id, permanent=permanent)
        if record is None:
            return {"ok": True}
        return ProjectRecord(**record)
    except service.ServiceError:
        raise _not_found("project")


@app.get("/media/reference-media", response_model=ReferenceMediaListResponse)
def list_reference_media(
    kind: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    items = service.list_available_reference_media(kind=kind, limit=limit, offset=offset, project_id=project_id)
    return ReferenceMediaListResponse(
        items=[ReferenceMediaRecord(**item) for item in items],
        limit=limit,
        offset=offset,
    )


@app.get("/media/reference-media/{reference_id}", response_model=ReferenceMediaRecord)
def get_reference_media(reference_id: str):
    record = store.get_reference_media(reference_id)
    if not record:
        raise _not_found("reference media")
    normalized = service.sanitize_reference_media_record(record)
    if not normalized:
        raise _not_found("reference media")
    return ReferenceMediaRecord(**normalized)


@app.delete("/media/reference-media/{reference_id}", response_model=ReferenceMediaRecord)
def delete_reference_media(reference_id: str):
    try:
        return ReferenceMediaRecord(**store.hide_reference_media(reference_id))
    except KeyError:
        raise _not_found("reference media")


@app.post("/media/reference-media/register", response_model=ReferenceMediaRecord)
def register_reference_media(payload: ReferenceMediaRegisterRequest):
    record = store.create_or_reuse_reference_media(payload.model_dump(), increment_usage=True)
    return ReferenceMediaRecord(**record)


@app.post("/media/reference-media/import", response_model=ReferenceMediaRecord)
async def import_reference_media(file: UploadFile = File(...)):
    filename = str(file.filename or "").strip()
    source_bytes = await file.read()
    if not source_bytes:
        raise _bad_request("Choose a reference file to import.")
    try:
        record = service.import_reference_media_bytes(
            source_bytes=source_bytes,
            source_name=filename or None,
            source_mime_type=file.content_type,
        )
        return ReferenceMediaRecord(**record)
    except service.ServiceError as exc:
        raise _bad_request(str(exc))


@app.post("/media/reference-media/backfill")
def backfill_reference_media():
    return service.backfill_reference_media()


@app.post("/media/reference-media/{reference_id}/use", response_model=ReferenceMediaRecord)
def mark_reference_media_used(reference_id: str):
    try:
        return ReferenceMediaRecord(**store.mark_reference_media_used(reference_id))
    except KeyError:
        raise _not_found("reference media")


@app.get("/media/projects/{project_id}/references", response_model=ReferenceMediaListResponse)
def list_project_references(
    project_id: str,
    kind: Optional[str] = Query(default=None),
):
    project = store.get_project(project_id)
    if not project:
        raise _not_found("project")
    normalized_items = [
        item
        for item in (
            service.sanitize_reference_media_record(record)
            for record in store.list_project_references(project_id, kind=kind)
        )
        if item
    ]
    return ReferenceMediaListResponse(
        items=[ReferenceMediaRecord(**item) for item in normalized_items],
        limit=len(normalized_items),
        offset=0,
    )


@app.post("/media/projects/{project_id}/references/{reference_id}", response_model=ReferenceMediaRecord)
def attach_project_reference(project_id: str, reference_id: str):
    try:
        return ReferenceMediaRecord(**service.attach_reference_to_project(project_id, reference_id))
    except service.ServiceError as exc:
        if "project not found" in str(exc).lower():
            raise _not_found("project")
        if "reference media not found" in str(exc).lower():
            raise _not_found("reference media")
        raise _bad_request(str(exc))


@app.delete("/media/projects/{project_id}/references/{reference_id}", response_model=ReferenceMediaRecord)
def detach_project_reference(project_id: str, reference_id: str):
    try:
        return ReferenceMediaRecord(**service.detach_reference_from_project(project_id, reference_id))
    except service.ServiceError as exc:
        if "project not found" in str(exc).lower():
            raise _not_found("project")
        if "reference media not found" in str(exc).lower():
            raise _not_found("reference media")
        raise _bad_request(str(exc))


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
    return [EnhancementConfigRecord(**service.public_enhancement_config(item)) for item in store.list_enhancement_configs()]


@app.get("/media/enhancement-configs/{model_key}", response_model=EnhancementConfigRecord)
def get_enhancement_config(model_key: str):
    record = store.get_enhancement_config(model_key)
    if not record:
        raise _not_found("enhancement config")
    return EnhancementConfigRecord(**service.public_enhancement_config(record))


@app.post("/media/enhancement-configs", response_model=EnhancementConfigRecord)
def create_enhancement_config(payload: EnhancementConfigUpsertRequest):
    record = service.upsert_enhancement_config(payload.model_dump())
    return EnhancementConfigRecord(**service.public_enhancement_config(record))


@app.patch("/media/enhancement-configs/{model_key}", response_model=EnhancementConfigRecord)
def update_enhancement_config(model_key: str, payload: EnhancementConfigUpsertRequest):
    record = service.upsert_enhancement_config(payload.model_dump(), model_key)
    return EnhancementConfigRecord(**service.public_enhancement_config(record))


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
            pricing_summary=bundle["pricing_summary"],
            final_prompt=bundle["final_prompt"],
            resolved_options=bundle["resolved_options"],
            warnings=bundle["preflight"].get("warnings") or [],
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
def list_jobs(limit: int = Query(default=200, le=500), project_id: Optional[str] = Query(default=None)):
    return JobsListResponse(items=[JobRecord(**item) for item in store.list_jobs(limit=limit, project_id=project_id)])


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
    runner.poll_job_once(job)
    return JobRecord(**store.get_job(job_id))


@app.post("/media/jobs/{job_id}/retry", response_model=SubmitResponse)
def retry_job(job_id: str):
    job = store.get_job(job_id)
    if not job:
        raise _not_found("job")
    batch = store.get_batch(job["batch_id"])
    payload = service.build_retry_submit_request(job, batch=batch)
    batch, jobs = service.submit_jobs(payload)
    return SubmitResponse(batch=BatchRecord(**batch), jobs=[JobRecord(**item) for item in jobs])


@app.post("/media/jobs/{job_id}/dismiss", response_model=JobRecord)
def dismiss_job(job_id: str):
    return JobRecord(**store.mark_job_dismissed(job_id))


@app.get("/media/batches", response_model=BatchesListResponse)
def list_batches(limit: int = Query(default=100, le=500), offset: int = Query(default=0, ge=0), project_id: Optional[str] = Query(default=None)):
    items = store.list_batches(limit=limit, offset=offset, project_id=project_id)
    batch_ids = [str(item.get("batch_id")) for item in items if item.get("batch_id")]
    jobs_by_batch: dict[str, list[dict]] = {}
    for job in store.list_jobs_for_batches(batch_ids, include_dismissed=False):
        batch_id = str(job.get("batch_id") or "")
        if not batch_id:
            continue
        jobs_by_batch.setdefault(batch_id, []).append(job)
    return BatchesListResponse(
        items=[BatchRecord(**{**item, "jobs": jobs_by_batch.get(str(item.get("batch_id")), [])}) for item in items],
        total=store.count_batches(project_id=project_id),
        limit=limit,
        offset=offset,
    )


@app.get("/media/batches/{batch_id}", response_model=BatchRecord)
def get_batch(batch_id: str):
    batch = store.get_batch(batch_id)
    if not batch:
        raise _not_found("batch")
    jobs = store.list_jobs_for_batches([batch_id], include_dismissed=False)
    return BatchRecord(**{**batch, "jobs": jobs})


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
    model_key: Optional[str] = None,
    status: Optional[str] = None,
    preset_key: Optional[str] = None,
    project_id: Optional[str] = Query(default=None),
):
    rows = store.list_assets(
        limit=limit + 1,
        cursor=cursor,
        favorites_only=favorites,
        media_type=media_type,
        model_key=model_key,
        status=status,
        preset_key=preset_key,
        project_id=project_id,
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [AssetRecord(**item) for item in rows]
    next_cursor = items[-1].created_at if has_more and items else None
    return AssetListResponse(items=items, next_cursor=next_cursor)


@app.get("/media/assets/latest", response_model=Optional[AssetRecord])
def latest_assets(project_id: Optional[str] = Query(default=None)):
    latest = store.list_assets(limit=1, project_id=project_id)
    if not latest:
        return None
    return AssetRecord(**latest[0])


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
def favorite_asset(asset_id: str, payload: Optional[FavoriteAssetRequest] = None, favorited: Optional[bool] = Query(default=None)):
    resolved_favorited = payload.favorited if payload is not None else (favorited if favorited is not None else True)
    return AssetRecord(**store.mark_asset_favorite(asset_id, resolved_favorited))


@app.post("/media/providers/kie/callback")
def kie_callback(request: Request, payload: dict):
    try:
        event = kie_adapter.verify_callback_request(payload, dict(request.headers))
    except Exception as exc:
        return JSONResponse(
            {"ok": False, "reason": str(exc) or "callback verification failed"},
            status_code=403,
        )
    task_id = event.get("task_id")
    if not task_id:
        return JSONResponse({"ok": False, "reason": "missing task_id"}, status_code=400)
    normalized_payload = dict(payload)
    if event.get("status") and not normalized_payload.get("state"):
        normalized_payload["state"] = event["status"]
    if event.get("task_id") and not normalized_payload.get("task_id"):
        normalized_payload["task_id"] = event["task_id"]
    if event.get("output_urls") and not normalized_payload.get("output_urls"):
        normalized_payload["output_urls"] = event["output_urls"]
    for job in store.list_jobs(include_dismissed=True):
        if job.get("provider_task_id") == task_id:
            store.update_job(job["job_id"], {"final_status_json": normalized_payload})
            store.append_job_event(job["job_id"], "provider_callback", normalized_payload)
            return {"ok": True}
    return {"ok": False, "reason": "unknown task_id"}
