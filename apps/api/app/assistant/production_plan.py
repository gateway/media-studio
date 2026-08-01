from __future__ import annotations

import math
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Literal, Optional, Union

from pydantic import BaseModel, Field, model_validator

from .. import store, store_assistant


PlanValue = Union[int, float, bool, str]


class ProductionConstraint(BaseModel):
    name: str = Field(min_length=1, max_length=120, pattern=r"^[a-z][a-z0-9_]*$")
    value: PlanValue
    source: Literal["user_request", "model_catalog", "derived"]
    model_key: Optional[str] = Field(default=None, max_length=160)
    catalog_path: Optional[str] = Field(default=None, max_length=240)
    derived_from: list[str] = Field(default_factory=list, max_length=4)
    operator: Optional[Literal["ceil_divide"]] = None


class ProductionPlanStep(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-z][a-z0-9_]*$")
    kind: Literal["character_sheet", "environment_sheet", "storyboard", "recipe", "graph", "run", "stitch"]
    title: str = Field(min_length=1, max_length=180)
    status: Literal["proposed", "ready", "in_progress", "done", "skipped"] = "proposed"
    depends_on: list[str] = Field(default_factory=list, max_length=12)
    artifact_ref: Optional[str] = Field(default=None, max_length=180)
    notes: str = Field(default="", max_length=800)


class ProductionPlan(BaseModel):
    version: Literal[1] = 1
    goal: str = Field(min_length=1, max_length=800)
    constraints: list[ProductionConstraint] = Field(default_factory=list, max_length=24)
    steps: list[ProductionPlanStep] = Field(min_length=1, max_length=32)


class ProposeProductionPlanArguments(BaseModel):
    plan: ProductionPlan


class ReadProductionPlanArguments(BaseModel):
    pass


class ProductionPlanStepPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=180)
    status: Optional[Literal["proposed", "ready", "in_progress", "done", "skipped"]] = None
    artifact_ref: Optional[str] = Field(default=None, max_length=180)
    notes: Optional[str] = Field(default=None, max_length=800)


class UpdateProductionPlanStepArguments(BaseModel):
    step_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-z][a-z0-9_]*$")
    updates: ProductionPlanStepPatch = Field(default_factory=ProductionPlanStepPatch)
    constraint_updates: list[ProductionConstraint] = Field(default_factory=list, max_length=4)
    reason: Optional[str] = Field(default=None, min_length=1, max_length=400)

    @model_validator(mode="after")
    def require_change(self) -> "UpdateProductionPlanStepArguments":
        if not self.updates.model_fields_set and not self.constraint_updates:
            raise ValueError("Update at least one identified plan field.")
        return self


class ProductionPlanError(Exception):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        retryable: bool = True,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or {}


def _catalog_value(evidence: Dict[str, Any], model_key: str, path: str) -> Any:
    value: Any = next(
        (item for item in evidence.get("models") or [] if isinstance(item, dict) and item.get("model_key") == model_key),
        None,
    )
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def _request_numbers(user_text: str) -> set[Decimal]:
    values = set()
    for token in re.findall(r"(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])", user_text):
        try:
            values.add(Decimal(token))
        except InvalidOperation:
            continue
    number_words = (
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
    )
    lowered = user_text.lower()
    values.update(
        Decimal(index)
        for index, word in enumerate(number_words, start=1)
        if re.search(rf"\b{word}\b", lowered)
    )
    return values


def _validate_constraints(
    plan: ProductionPlan,
    evidence_items: list[Dict[str, Any]],
    user_text: str,
    *,
    trusted_plan: Optional[ProductionPlan] = None,
) -> None:
    by_name = {item.name: item for item in plan.constraints}
    trusted_by_name = {
        item.name: item
        for item in trusted_plan.constraints
    } if trusted_plan else {}
    if len(by_name) != len(plan.constraints):
        raise ProductionPlanError(code="production_constraint_duplicate", message="Constraint names must be unique.")
    for item in plan.constraints:
        unchanged = trusted_by_name.get(item.name) == item
        if (
            item.source == "user_request"
            and not unchanged
            and isinstance(item.value, (int, float))
            and not isinstance(item.value, bool)
            and Decimal(str(item.value)) not in _request_numbers(user_text)
        ):
            raise ProductionPlanError(
                code="production_constraint_ungrounded",
                message=f"Constraint {item.name} does not match a number in the current request.",
            )
        if item.source == "model_catalog":
            if not item.model_key or not item.catalog_path:
                raise ProductionPlanError(code="production_constraint_ungrounded", message="Catalog constraints require a model key and catalog path.")
            grounded = item.value if unchanged else next(
                (
                    value
                    for value in (
                        _catalog_value(evidence, item.model_key, item.catalog_path)
                        for evidence in evidence_items
                    )
                    if value is not None
                ),
                None,
            )
            if grounded != item.value:
                raise ProductionPlanError(code="production_constraint_ungrounded", message=f"Constraint {item.name} does not match catalog evidence from this turn.")
        elif item.source == "derived":
            inputs = [by_name.get(name) for name in item.derived_from]
            if item.operator != "ceil_divide" or len(inputs) != 2 or any(value is None for value in inputs):
                raise ProductionPlanError(code="production_constraint_derivation_invalid", message=f"Constraint {item.name} has an invalid derivation.")
            numerator, denominator = (value.value for value in inputs if value is not None)
            if not isinstance(numerator, (int, float)) or not isinstance(denominator, (int, float)) or denominator <= 0:
                raise ProductionPlanError(code="production_constraint_derivation_invalid", message=f"Constraint {item.name} needs two numeric inputs.")
            if item.value != math.ceil(numerator / denominator):
                raise ProductionPlanError(code="production_constraint_derivation_invalid", message=f"Constraint {item.name} does not match its typed derivation.")


def _validate_steps(plan: ProductionPlan) -> None:
    by_id = {step.id: step for step in plan.steps}
    if len(by_id) != len(plan.steps):
        raise ProductionPlanError(code="production_step_duplicate", message="Production plan step ids must be unique.")
    missing = sorted({dependency for step in plan.steps for dependency in step.depends_on if dependency not in by_id})
    if missing:
        raise ProductionPlanError(code="production_step_dependency_missing", message=f"Unknown step dependencies: {', '.join(missing)}.")
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(step_id: str) -> None:
        if step_id in visiting:
            raise ProductionPlanError(code="production_step_dependency_cycle", message="Production plan dependencies must not contain a cycle.")
        if step_id in visited:
            return
        visiting.add(step_id)
        for dependency in by_id[step_id].depends_on:
            visit(dependency)
        visiting.remove(step_id)
        visited.add(step_id)

    for step_id in by_id:
        visit(step_id)
    for step in plan.steps:
        if step.status not in {"ready", "in_progress", "done"}:
            continue
        blockers = [
            dependency
            for dependency in step.depends_on
            if by_id[dependency].status not in {"done", "skipped"}
        ]
        if blockers:
            raise ProductionPlanError(
                code="production_step_dependency_blocked",
                message="Finish or explicitly skip the blocking production steps first.",
                details={"step_id": step.id, "blocking_step_ids": blockers},
            )


def read_production_plan(_arguments: BaseModel, context: Any) -> Dict[str, Any]:
    session = (
        store_assistant.get_assistant_session(context.session_id)
        if context.session_id
        else context.session
    )
    summary = session.get("summary_json") if isinstance(session, dict) and isinstance(session.get("summary_json"), dict) else {}
    plan = summary.get("production_plan")
    return {"exists": isinstance(plan, dict), "plan": plan if isinstance(plan, dict) else None}


def _session_plan(context: Any) -> tuple[Dict[str, Any], Dict[str, Any], ProductionPlan]:
    session = (
        store_assistant.get_assistant_session(context.session_id)
        if context.session_id
        else None
    ) or dict(context.session or {})
    summary = dict(session.get("summary_json") or {})
    payload = summary.get("production_plan")
    if not isinstance(payload, dict):
        raise ProductionPlanError(
            code="production_plan_missing",
            message="Create a production plan before updating a step.",
        )
    return session, summary, ProductionPlan.model_validate(payload)


def _saved_artifact_refs(session_id: str) -> set[str]:
    refs = set()
    for message in store_assistant.list_assistant_messages(session_id):
        content = message.get("content_json")
        saved = content.get("saved_artifact") if isinstance(content, dict) else None
        if not isinstance(saved, dict):
            continue
        kind = str(saved.get("kind") or "")
        artifact_id = str(saved.get("id") or "")
        if kind and artifact_id:
            refs.add(f"{kind}:{artifact_id}")
    return refs


def _confirmed_workflow_ids(session_id: str, session: Dict[str, Any]) -> set[str]:
    confirmed_ids = {
        str(plan.get("applied_workflow_id") or "")
        for plan in store_assistant.list_assistant_plans(session_id)
        if str(plan.get("status") or "") == "applied"
    }
    owner_id = str(session.get("owner_id") or "")
    if (
        str(session.get("owner_kind") or "") == "graph_workflow"
        and owner_id
        and store.get_graph_workflow(owner_id)
    ):
        confirmed_ids.add(owner_id)
    return confirmed_ids


def _artifact_state(artifact_ref: str, session: Dict[str, Any]) -> str:
    session_id = str(session.get("assistant_session_id") or "")
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    if artifact_ref == "story_state":
        return "complete" if isinstance(summary.get("kernel_story_state"), dict) else "missing"
    if artifact_ref in _saved_artifact_refs(session_id):
        return "complete"
    prefix, separator, value = artifact_ref.partition(":")
    if not separator or not value:
        return "missing"
    if prefix == "assistant_plan":
        plan = store_assistant.get_assistant_plan(value)
        if not plan or str(plan.get("assistant_session_id") or "") != session_id:
            return "missing"
        status = str(plan.get("status") or "")
        return "complete" if status == "applied" else "pending" if status == "validated" else "missing"
    if prefix == "workflow":
        return "complete" if value in _confirmed_workflow_ids(session_id, session) else "missing"
    if prefix == "run":
        run = store.get_graph_run(value)
        return (
            "complete"
            if run
            and str(run.get("status") or "") == "completed"
            and str(run.get("workflow_id") or "") in _confirmed_workflow_ids(session_id, session)
            else "missing"
        )
    if prefix == "asset":
        asset = store.get_asset(value)
        run = store.get_graph_run(str(asset.get("run_id") or "")) if asset else None
        return (
            "complete"
            if asset
            and str(asset.get("status") or "") == "completed"
            and run
            and str(run.get("workflow_id") or "") in _confirmed_workflow_ids(session_id, session)
            else "missing"
        )
    return "missing"


def _artifact_kind(artifact_ref: str) -> str:
    return "story_state" if artifact_ref == "story_state" else artifact_ref.partition(":")[0]


def _validate_artifact_kind(step: ProductionPlanStep) -> None:
    if not step.artifact_ref:
        return
    allowed = {
        "character_sheet": {"story_state", "asset"},
        "environment_sheet": {"story_state", "asset"},
        "storyboard": {"story_state", "asset"},
        "recipe": {"prompt_recipe"},
        "graph": {"assistant_plan", "workflow"},
        "run": {"run"},
        "stitch": {"asset"},
    }[step.kind]
    if _artifact_kind(step.artifact_ref) not in allowed:
        raise ProductionPlanError(
            code="production_step_artifact_kind_invalid",
            message=f"Artifact {step.artifact_ref} cannot complete a {step.kind} step.",
        )


def _validate_plan_artifacts(plan: ProductionPlan, session: Dict[str, Any]) -> None:
    for step in plan.steps:
        if step.status == "skipped":
            if step.artifact_ref:
                raise ProductionPlanError(
                    code="production_step_skip_has_artifact",
                    message="A skipped step cannot claim an artifact.",
                )
            if not step.notes.strip():
                raise ProductionPlanError(
                    code="production_step_skip_reason_required",
                    message="Skipping a production step requires an explicit reason.",
                )
        if step.artifact_ref:
            _validate_artifact_kind(step)
            artifact_state = _artifact_state(step.artifact_ref, session)
            if artifact_state == "missing":
                raise ProductionPlanError(
                    code="production_step_artifact_invalid",
                    message="The artifact does not belong to this assistant session or confirmed workflow.",
                )
        else:
            artifact_state = "missing"
        if step.status == "done" and artifact_state != "complete":
            raise ProductionPlanError(
                code="production_step_artifact_required",
                message="A completed production step requires a completed session-owned artifact.",
            )


def _updated_constraints(
    current: ProductionPlan,
    replacements: list[ProductionConstraint],
) -> list[ProductionConstraint]:
    by_name = {item.name: item for item in replacements}
    if len(by_name) != len(replacements):
        raise ProductionPlanError(
            code="production_constraint_duplicate",
            message="Constraint updates must identify unique names.",
        )
    updated = [by_name.pop(item.name, item) for item in current.constraints]
    updated.extend(by_name.values())
    return updated


def update_production_plan_step(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    options = UpdateProductionPlanStepArguments.model_validate(arguments)
    session, summary, current = _session_plan(context)
    step_index = next(
        (index for index, step in enumerate(current.steps) if step.id == options.step_id),
        None,
    )
    if step_index is None:
        raise ProductionPlanError(
            code="production_step_missing",
            message=f"Production plan step {options.step_id} does not exist.",
        )
    steps = list(current.steps)
    step = steps[step_index]
    updates = options.updates.model_dump(exclude_unset=True)
    next_step = ProductionPlanStep.model_validate(
        {**step.model_dump(mode="json"), **updates}
    )
    if next_step.status == "skipped" and step.status != "skipped":
        reason = str(options.reason or "").strip()
        if not reason:
            raise ProductionPlanError(
                code="production_step_skip_reason_required",
                message="Skipping a production step requires an explicit reason.",
            )
        note = f"Skip reason: {reason}"
        next_step = next_step.model_copy(
            update={"notes": f"{next_step.notes}\n{note}".strip()}
        )
    by_id = {item.id: item for item in current.steps}
    if next_step.status in {"ready", "in_progress", "done"}:
        blockers = [
            dependency
            for dependency in next_step.depends_on
            if by_id[dependency].status not in {"done", "skipped"}
        ]
        if blockers:
            raise ProductionPlanError(
                code="production_step_dependency_blocked",
                message="Finish or explicitly skip the blocking production steps first.",
                details={"blocking_step_ids": blockers},
            )
    steps[step_index] = next_step
    plan = ProductionPlan.model_validate(
        {
            **current.model_dump(mode="json"),
            "steps": steps,
            "constraints": _updated_constraints(current, options.constraint_updates),
        }
    )
    _validate_steps(plan)
    _validate_plan_artifacts(plan, session)
    _validate_constraints(
        plan,
        context.tool_evidence,
        context.user_text,
        trusted_plan=current,
    )
    payload = plan.model_dump(mode="json")
    summary["production_plan"] = payload
    store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    return {"changed_step_id": options.step_id, "plan": payload}


def propose_production_plan(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    options = ProposeProductionPlanArguments.model_validate(arguments)
    if not context.session_id:
        raise ProductionPlanError(
            code="production_plan_session_unavailable",
            message="A production plan requires an active assistant session.",
            retryable=False,
        )
    _validate_constraints(options.plan, context.tool_evidence, context.user_text)
    _validate_steps(options.plan)
    session = store_assistant.get_assistant_session(context.session_id) or dict(context.session or {})
    _validate_plan_artifacts(options.plan, session)
    summary = dict(session.get("summary_json") or {})
    plan = options.plan.model_dump(mode="json")
    summary["production_plan"] = plan
    store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    return {"plan": plan}
