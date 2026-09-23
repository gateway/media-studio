"""Exercise recipe continuation through the full kernel using current read-only records."""
import argparse
import copy
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from app import db
from app.settings import settings

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--db", type=Path, required=True)
parser.add_argument("--source-session", required=True)
args = parser.parse_args()
assert args.db.resolve() == settings.db_path.resolve() and args.db.stat().st_size > 0

@contextmanager
def readonly():
    connection = sqlite3.connect(args.db.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("pragma query_only=ON")
    try:
        yield connection
    finally:
        connection.close()

db.get_connection = readonly
from app import store_assistant
from app.assistant import kernel
from app.graph.schemas import GraphWorkflow

session = store_assistant.get_assistant_session(args.source_session)
assert session
workflow = GraphWorkflow.model_validate(session["state_snapshot_json"]["workflow"])
retained_summary = copy.deepcopy(session["summary_json"])
session = copy.deepcopy(session)
session.update(summary_json={}, provider_thread_id=None)

def persist(value):
    session.update(copy.deepcopy(value))
    return copy.deepcopy(session)

store_assistant.get_assistant_session = lambda _: copy.deepcopy(session)
store_assistant.create_or_update_assistant_session = persist
def forbidden(**kwargs):
    raise AssertionError("External provider execution forbidden")
kernel.run_read_only_provider_turn = forbidden
request = "Build a graph with a recipe taking image 1 as identity and image 2 as product, preserving both in a product portrait."
steps = iter([
    {"tool_call": {"name": "search_prompt_recipes", "arguments": {"query": "identity product ordered", "limit": 3}}},
    {"tool_call": {"name": "offer_recipe_continuation", "arguments": {"missing_requirements": "Ordered identity and product references"}}, "reply": "I can draft the missing recipe for review."},
    {"reply": "I can draft the missing recipe for review."},
])
provider_calls = []
def provider(**kwargs):
    provider_calls.append(kwargs)
    return {"capability": "graph_builder", "artifact_intent": "none", **next(steps)}
kernel.run_kernel_provider_step = provider
result = kernel.run_assistant_kernel_turn(
    session=session, user_text=request, workflow=workflow,
    canvas_context={"workspace_key": "current-review-origin"}, assistant_mode="graph",
    client_user_message_id="current-request-projection",
)
assert all(not trace.error for trace in result.trace.tool_calls), result.trace.model_dump()
continuation = session["summary_json"].get("kernel_recipe_continuation")
assert continuation, "Missing recipe has no explicit continuation offer"
assert continuation["request"] == request
assert continuation["origin_message_id"] == "current-request-projection"
assert continuation["workspace_key"] == "current-review-origin"
assert continuation["state"] == "offered"
assert result.next_action.kind == "none"
assert not session["summary_json"].get("kernel_recipe_draft")
print("PASS missing recipe offers an explicit continuation with frozen request and destination; no draft/save/apply/run")

assert len(provider_calls) == 2, "A complete offer unnecessarily requests another provider reply"

# Keep the agreed full-kernel boundary: execute the public kernel message lifecycle,
# replacing only provider and persistence boundaries with in-memory current records.
from app.assistant.kernel_route import create_kernel_message
from app.assistant.schemas import AssistantMessageCreateRequest
from app.assistant.provider_support import assistant_provider_fields
session.update(assistant_provider_fields(session))
session["assistant_session_id"] = "readonly-continuation-projection"
messages = []
def create_message(record):
    saved = {**copy.deepcopy(record), "assistant_message_id": f"projection-{len(messages)}"}
    messages.append(saved)
    return copy.deepcopy(saved)
store_assistant.create_assistant_message = create_message
store_assistant.list_assistant_messages = lambda _: copy.deepcopy(messages)
session["summary_json"].update({key: value for key, value in retained_summary.items() if key.startswith("kernel_recipe_")})
assert session["summary_json"].get("kernel_recipe_draft"), "Source must retain the actual earlier recipe draft"
offered = copy.deepcopy(continuation)
def clarification(**kwargs):
    return {"capability": "recipe_builder", "artifact_intent": "none", "reply": "Which aspect ratio should this use?"}
kernel.run_kernel_provider_step = clarification
payload = AssistantMessageCreateRequest(content_text="Draft needed recipe", workflow=workflow,
    canvas_context={"workspace_key": "current-review-origin"},
    continuation={"id": offered["id"], "token": offered["token"], "action": "draft"})
updated = create_kernel_message(session=copy.deepcopy(session), payload=payload, attachments=[])
assert updated["summary_json"]["kernel_recipe_continuation"]["state"] == "interrupted", "A clarification adopted an unrelated retained draft"
assert updated["summary_json"]["kernel_recipe_draft"] == retained_summary["kernel_recipe_draft"]
print("PASS clarification cannot adopt a historical recipe draft")

from app import store
from app.assistant.provenance import recipe_quality_contract_hash
recipe = store.get_prompt_recipe("recipe_b6a96fddaaad")
assert recipe
ready = {**offered, "state": "ready", "consumed_actions": ["draft"], "recipe_id": recipe["recipe_id"], "recipe_hash": recipe_quality_contract_hash(recipe)}
session["summary_json"]["kernel_recipe_continuation"] = copy.deepcopy(ready)
kernel.run_kernel_provider_step = lambda **kwargs: {"capability": "graph_builder", "artifact_intent": "none", "reply": "Which image model should this graph use?"}
return_payload = payload.model_copy(update={"continuation": payload.continuation.model_copy(update={"action": "return"})})
updated = create_kernel_message(session=copy.deepcopy(session), payload=return_payload, attachments=[])
assert updated["summary_json"]["kernel_recipe_continuation"]["state"] == "interrupted", "Return was marked complete without preparing a graph proposal"
failed_return = copy.deepcopy(updated)
print("PASS return clarification remains incomplete without a fresh graph proposal")

from app.assistant.cancellation import cancel_session
from fastapi import HTTPException
session["summary_json"]["kernel_recipe_continuation"] = copy.deepcopy(offered)
def cancel_during_provider(**kwargs):
    assert cancel_session(session["assistant_session_id"])
    return {"capability": "recipe_builder", "artifact_intent": "none", "reply": "Drafting stopped."}
kernel.run_kernel_provider_step = cancel_during_provider
try:
    create_kernel_message(session=copy.deepcopy(session), payload=payload, attachments=[])
except HTTPException as exc:
    assert exc.status_code == 409
assert session["summary_json"]["kernel_recipe_continuation"]["state"] == "cancelled", "Cancellation must be terminal even when the provider returns concurrently"
print("PASS active cancellation invalidates continuation despite racing provider completion")

# Successful explicit drafting, immutable requirements, and replay use the same
# public lifecycle and actual validated recipe contract retained by the installation.
session["summary_json"] = {"kernel_recipe_continuation": copy.deepcopy(offered)}
calls = []
def draft_provider(**kwargs):
    calls.append(kwargs)
    assert request in str(kwargs["messages"])
    return {"capability": "recipe_builder", "artifact_intent": "draft_recipe",
        "tool_call": {"name": "propose_prompt_recipe_draft", "arguments": {"draft": retained_summary["kernel_recipe_draft"]}},
        "reply": "Recipe draft ready for review."}
kernel.run_kernel_provider_step = draft_provider
updated = create_kernel_message(session=copy.deepcopy(session), payload=payload, attachments=[])
assert updated["summary_json"]["kernel_recipe_continuation"]["state"] == "awaiting_save"
assert updated["summary_json"]["kernel_recipe_draft"]["key"] == retained_summary["kernel_recipe_draft"]["key"]
assert not updated["summary_json"]["kernel_recipe_proposal"]["save_ready"]
message_count, call_count = len(messages), len(calls)
replayed = create_kernel_message(session=copy.deepcopy(session), payload=payload, attachments=[])
assert len(messages) == message_count and len(calls) == call_count
assert replayed == updated
print("PASS explicit draft preserves original request; replay creates no turn or artifact; save remains separate")

def reject(record, candidate):
    session["summary_json"]["kernel_recipe_continuation"] = copy.deepcopy(record)
    kernel.run_kernel_provider_step = forbidden
    try:
        create_kernel_message(session=copy.deepcopy(session), payload=candidate, attachments=[])
    except HTTPException as exc:
        assert exc.status_code == 409
    else:
        raise AssertionError("Invalid continuation reached success")

reject(offered, payload.model_copy(update={"continuation": payload.continuation.model_copy(update={"token": "wrong-token"})}))
reject(offered, payload.model_copy(update={"continuation": payload.continuation.model_copy(update={"id": "other-session-continuation"})}))
reject(offered, payload.model_copy(update={"canvas_context": {"workspace_key": "different-tab"}}))
changed = workflow.model_copy(deep=True)
changed.nodes = [] if workflow.nodes else [__import__("app.graph.schemas", fromlist=["GraphWorkflowNode"]).GraphWorkflowNode(id="added", type="prompt.text", position={"x":0,"y":0}, fields={"text":"changed"})]
reject(offered, payload.model_copy(update={"workflow": changed}))
reject({**offered, "expires_at": 0}, payload)
reject(offered, return_payload)
reject({**ready, "recipe_hash": "changed-contract"}, return_payload)
reject({**offered, "state": "cancelled"}, payload)
print("PASS wrong token/session, changed or missing destination, expired/cancelled origin, unsaved or changed recipe cannot dispatch")

from concurrent.futures import ThreadPoolExecutor
from threading import Event
session["summary_json"] = {"kernel_recipe_continuation": copy.deepcopy(offered)}
entered, release = Event(), Event()
def held_provider(**kwargs):
    entered.set()
    assert release.wait(5)
    return {"capability": "recipe_builder", "artifact_intent": "none", "reply": "One clarification."}
kernel.run_kernel_provider_step = held_provider
with ThreadPoolExecutor(max_workers=1) as executor:
    pending = executor.submit(create_kernel_message, session=copy.deepcopy(session), payload=payload, attachments=[])
    try:
        assert entered.wait(5)
        try:
            create_kernel_message(session=copy.deepcopy(session), payload=payload, attachments=[])
        except HTTPException as exc:
            assert exc.status_code == 409
        else:
            raise AssertionError("Concurrent continuation escaped the session lock")
    finally:
        release.set()
    pending.result(timeout=5)
print("PASS concurrent continuation clicks cannot start a second provider turn")

# A provider cannot substitute an unrelated saved recipe during typed return.
source_plan = store_assistant.get_assistant_plan("asplan_e3a8cd9a3852")
assert source_plan and source_plan["plan_json"]["operations"]
other_recipe = next(item for item in store.list_prompt_recipes(status="active") if item["recipe_id"] != recipe["recipe_id"])
plans = {}
def save_plan(record):
    item = {**copy.deepcopy(record), "assistant_plan_id": "projection-plan"}
    plans[item["assistant_plan_id"]] = item
    return copy.deepcopy(item)
store_assistant.create_or_update_assistant_plan = save_plan
store_assistant.get_assistant_plan = lambda key: copy.deepcopy(plans.get(key))
store_assistant.list_assistant_plans = lambda _: copy.deepcopy(list(plans.values()))
session["summary_json"] = {"kernel_recipe_continuation": {**ready, "recipe_id": other_recipe["recipe_id"], "recipe_hash": recipe_quality_contract_hash(other_recipe)}}
def wrong_graph(**kwargs):
    return {"capability": "graph_builder", "artifact_intent": "none", "reply": "Graph ready.",
        "tool_call": {"name": "propose_graph_operations", "arguments": {"operations": source_plan["plan_json"]["operations"], "summary": "Prepare the saved recipe graph"}}}
kernel.run_kernel_provider_step = wrong_graph
updated = create_kernel_message(session=copy.deepcopy(session), payload=return_payload, attachments=[])
trace = messages[-1]["content_json"]["kernel_turn"]["trace"]
assert any(call.get("error", {}).get("code") == "continuation_recipe_mismatch" for call in trace["tool_calls"]), trace
assert not plans, "An unrelated recipe graph became confirmable"
print("PASS typed return cannot substitute a different saved recipe")

session["summary_json"] = {"kernel_recipe_continuation": copy.deepcopy(ready)}
updated = create_kernel_message(session=copy.deepcopy(session), payload=return_payload, attachments=[])
assert updated["summary_json"]["kernel_recipe_continuation"]["state"] == "returned"
assert messages[-1]["content_json"]["next_action"]["kind"] == "confirm_graph"
assert len(plans) == 1 and next(iter(plans.values()))["status"] == "validated"
kernel.run_kernel_provider_step = forbidden
count = len(messages)
replayed = create_kernel_message(session=copy.deepcopy(session), payload=return_payload, attachments=[])
assert replayed == updated and len(messages) == count
print("PASS exact saved recipe returns one confirmable proposal; replay does not apply, run, or dispatch")

session.update(copy.deepcopy(failed_return))
plans.clear()
kernel.run_kernel_provider_step = wrong_graph
retry_payload = AssistantMessageCreateRequest.model_validate({**return_payload.model_dump(), "continuation": {"id": ready["id"], "token": session["summary_json"]["kernel_recipe_continuation"]["token"], "action": "retry"}})
updated = create_kernel_message(session=copy.deepcopy(session), payload=retry_payload, attachments=[])
assert updated["summary_json"]["kernel_recipe_continuation"]["state"] == "returned"
kernel.run_kernel_provider_step = forbidden
count = len(messages)
assert create_kernel_message(session=copy.deepcopy(session), payload=retry_payload, attachments=[]) == updated
assert len(messages) == count
print("PASS incomplete return resumes explicitly under the frozen origin; network replay never dispatches twice")

from app.assistant.provider_support import cancel_assistant_session
session["summary_json"]["kernel_recipe_continuation"] = {**offered, "state": "awaiting_save"}
cancelled = cancel_assistant_session(copy.deepcopy(session))
assert cancelled["summary_json"]["kernel_recipe_continuation"]["state"] == "cancelled", "A stop arriving just after drafting must still cancel the continuation"
print("PASS late cancellation preserves retained artifacts and invalidates the continuation")

reject(offered, payload.model_copy(update={"continuation": payload.continuation.model_copy(update={"token": "é-invalid"})}))
print("PASS malformed Unicode token is rejected without provider execution")
