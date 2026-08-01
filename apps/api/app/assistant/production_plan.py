from __future__ import annotations

import math
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Literal, Optional, Union

from pydantic import BaseModel, Field

from .. import store_assistant


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


class ProductionPlanError(Exception):
    def __init__(self, *, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


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
    return values


def _validate_constraints(
    plan: ProductionPlan,
    evidence_items: list[Dict[str, Any]],
    user_text: str,
) -> None:
    by_name = {item.name: item for item in plan.constraints}
    if len(by_name) != len(plan.constraints):
        raise ProductionPlanError(code="production_constraint_duplicate", message="Constraint names must be unique.")
    for item in plan.constraints:
        if (
            item.source == "user_request"
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
            grounded = next(
                (value for value in (_catalog_value(evidence, item.model_key, item.catalog_path) for evidence in evidence_items) if value is not None),
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


def read_production_plan(_arguments: BaseModel, context: Any) -> Dict[str, Any]:
    session = (
        store_assistant.get_assistant_session(context.session_id)
        if context.session_id
        else context.session
    )
    summary = session.get("summary_json") if isinstance(session, dict) and isinstance(session.get("summary_json"), dict) else {}
    plan = summary.get("production_plan")
    return {"exists": isinstance(plan, dict), "plan": plan if isinstance(plan, dict) else None}


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
    summary = dict(session.get("summary_json") or {})
    plan = options.plan.model_dump(mode="json")
    summary["production_plan"] = plan
    store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    return {"plan": plan}
