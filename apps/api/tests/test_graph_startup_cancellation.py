"""Real runtime/store cancellation interleavings; requires the normal CI fixtures."""
from contextlib import contextmanager
import importlib
import sqlite3
import threading

import pytest


def _queued_run(client, monkeypatch):
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    workflow = {"name": "Startup cancellation", "nodes": [{"id": "text", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "Provider-free regression"}}], "edges": []}
    saved = client.post("/media/graph/workflows", json=workflow)
    assert saved.status_code == 200, saved.text
    run = runtime.create_run(saved.json()["workflow_id"], GraphWorkflow(**workflow), start=False)
    calls = []
    monkeypatch.setattr(runtime.executors["prompt.text"], "execute", lambda node, context: calls.append(node.id) or {})
    return runtime, run.run_id, calls


def _snapshot(store, run_id):
    return {"run": store.get_graph_run(run_id), "nodes": store.list_graph_run_nodes(run_id), "events": store.list_graph_run_events(run_id)}


def _cancel(client, store, run_id):
    response = client.post(f"/media/graph/runs/{run_id}/cancel")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    return _snapshot(store, run_id)


def test_cancelled_before_worker_is_not_restarted(client, app_modules, monkeypatch):
    runtime, run_id, calls = _queued_run(client, monkeypatch)
    cancelled = _cancel(client, app_modules["store"], run_id)
    runtime.execute_run(run_id)
    assert calls == []
    assert _snapshot(app_modules["store"], run_id) == cancelled


def test_cancel_after_initial_read_does_not_append_stale_startup_events(client, app_modules, monkeypatch):
    runtime, run_id, calls = _queued_run(client, monkeypatch)
    store = app_modules["store"]
    original = store.get_graph_run
    entered, release = threading.Event(), threading.Event()
    paused = False

    def read(current_id):
        nonlocal paused
        record = original(current_id)
        if not paused and threading.current_thread() is worker:
            paused = True
            entered.set()
            assert release.wait(5), "initial-read barrier timed out"
        return record

    monkeypatch.setattr(store, "get_graph_run", read)
    worker = threading.Thread(target=runtime.execute_run, args=(run_id,))
    worker.start()
    try:
        assert entered.wait(5), "worker did not read the queued run"
        cancelled = _cancel(client, store, run_id)
    finally:
        release.set()
        worker.join(5)
    assert not worker.is_alive() and calls == []
    assert _snapshot(store, run_id) == cancelled


@pytest.mark.parametrize("valid", [True, False])
def test_cancel_during_validation_preserves_acknowledged_state(client, app_modules, monkeypatch, valid):
    from app.graph.schemas import GraphError, GraphValidationResult

    runtime, run_id, calls = _queued_run(client, monkeypatch)
    entered, release = threading.Event(), threading.Event()

    def validate(workflow):
        entered.set()
        assert release.wait(5), "validation barrier timed out"
        return GraphValidationResult(valid=valid, errors=[] if valid else [GraphError(code="invalid-test", message="Invalid regression input")])

    monkeypatch.setattr(importlib.import_module("app.graph.runtime"), "validate_workflow", validate)
    worker = threading.Thread(target=runtime.execute_run, args=(run_id,))
    worker.start()
    try:
        assert entered.wait(5), "worker did not enter validation"
        cancelled = _cancel(client, app_modules["store"], run_id)
    finally:
        release.set()
        worker.join(5)
    assert not worker.is_alive()
    assert calls == []
    assert all(node["status"] == "cancelled" for node in cancelled["nodes"])
    assert _snapshot(app_modules["store"], run_id) == cancelled


@pytest.mark.parametrize("boundary", ["running", "failed", "skipped_node"])
def test_cancel_at_persistence_boundary_is_not_overwritten(client, app_modules, monkeypatch, boundary):
    from app.graph.schemas import GraphError, GraphValidationResult

    runtime, run_id, calls = _queued_run(client, monkeypatch)
    store = app_modules["store"]
    if boundary != "running":
        monkeypatch.setattr(importlib.import_module("app.graph.runtime"), "validate_workflow", lambda workflow: GraphValidationResult(valid=False, errors=[GraphError(code="invalid-test", message="Invalid regression input")]))
    entered, release = threading.Event(), threading.Event()
    paused = False

    class ConnectionProxy:
        def __init__(self, connection): self.connection = connection
        def __getattr__(self, name): return getattr(self.connection, name)
        def execute(self, sql, parameters=()):
            nonlocal paused
            statement = sql.strip().upper()
            table = "GRAPH_RUN_NODES" if boundary == "skipped_node" else "GRAPH_RUNS"
            target_status = "skipped" if boundary == "skipped_node" else boundary
            writes_target = statement.startswith((f"UPDATE {table} ", f"INSERT INTO {table} "))
            if not paused and threading.current_thread() is worker and writes_target and target_status in parameters:
                paused = True
                entered.set()
                assert release.wait(5), "persistence barrier timed out"
            return self.connection.execute(sql, parameters)

    # Both the historical upsert and a conditional UPDATE pass this boundary.
    # No DB statement is replaced: the actual SQLite write runs after cancellation.
    for module_name in ["app.store_graph", "app.store_support"]:
        module = importlib.import_module(module_name)
        original = module.get_connection

        @contextmanager
        def connection(original=original):
            with original() as current:
                yield ConnectionProxy(current)

        monkeypatch.setattr(module, "get_connection", connection)
    worker = threading.Thread(target=runtime.execute_run, args=(run_id,))
    worker.start()
    try:
        assert entered.wait(5), "worker did not reach the requested write boundary"
        cancelled = _cancel(client, store, run_id)
    finally:
        release.set()
        worker.join(5)
    assert not worker.is_alive()
    assert calls == []
    assert _snapshot(store, run_id) == cancelled


def test_queued_cancel_handler_keeps_finalization_ownership(client, app_modules, monkeypatch):
    from app.graph.schemas import GraphValidationResult

    runtime, run_id, calls = _queued_run(client, monkeypatch)
    module = importlib.import_module("app.graph.runtime")
    validation_entered, release_validation = threading.Event(), threading.Event()
    cancelling_emitted, release_cancel = threading.Event(), threading.Event()
    original_emit = module.emit

    def validate(workflow):
        validation_entered.set()
        assert release_validation.wait(5)
        return GraphValidationResult(valid=True)

    def emit(*args, **kwargs):
        result = original_emit(*args, **kwargs)
        if args[1] == "run.cancelling":
            cancelling_emitted.set()
            assert release_cancel.wait(5)
        return result

    monkeypatch.setattr(module, "validate_workflow", validate)
    monkeypatch.setattr(module, "emit", emit)
    responses = []

    def cancel_request():
        assert validation_entered.wait(5), "worker did not enter validation"
        responses.append(client.post(f"/media/graph/runs/{run_id}/cancel"))

    worker = threading.Thread(target=runtime.execute_run, args=(run_id,))
    cancel = threading.Thread(target=cancel_request)
    worker.start()
    cancel.start()
    try:
        assert cancelling_emitted.wait(5)
        release_validation.set()
        worker.join(5)
        assert not worker.is_alive()
    finally:
        release_validation.set()
        release_cancel.set()
        cancel.join(5)
        worker.join(5)
    assert not cancel.is_alive() and len(responses) == 1
    final = _snapshot(app_modules["store"], run_id)
    assert {
        "http_status": responses[0].status_code,
        "returned_status": responses[0].json()["status"],
        "executor_calls": calls,
        "cancelled_node_count": final["run"]["metrics_json"]["cancelled_node_count"],
        "cancelled_node_ids": final["run"]["metrics_json"]["cancelled_node_ids"],
        "terminal_events": [event["event_type"] for event in final["events"]].count("run.cancelled"),
    } == {"http_status": 200, "returned_status": "cancelled", "executor_calls": [], "cancelled_node_count": 1, "cancelled_node_ids": ["text"], "terminal_events": 1}


def test_resuming_worker_finishes_cancellation_requested_during_validation(client, app_modules, monkeypatch):
    from app.graph.schemas import GraphValidationResult

    runtime, run_id, calls = _queued_run(client, monkeypatch)
    store = app_modules["store"]
    store.update_graph_run(run_id, {"status": "running"})
    entered, release = threading.Event(), threading.Event()

    def validate(workflow):
        entered.set()
        assert release.wait(5)
        return GraphValidationResult(valid=True)

    monkeypatch.setattr(importlib.import_module("app.graph.runtime"), "validate_workflow", validate)
    worker = threading.Thread(target=lambda: runtime.execute_run(run_id, resume=True))
    worker.start()
    try:
        assert entered.wait(5)
        response = client.post(f"/media/graph/runs/{run_id}/cancel")
        assert response.status_code == 200 and response.json()["status"] == "cancelling"
    finally:
        release.set()
        worker.join(5)
    assert not worker.is_alive() and calls == []
    final = _snapshot(store, run_id)
    assert final["run"]["status"] == "cancelled"
    assert all(node["status"] == "cancelled" for node in final["nodes"])
    assert [event["event_type"] for event in final["events"]].count("run.cancelled") == 1


@pytest.mark.parametrize("status", ["completed", "failed"])
def test_terminal_runs_are_not_restarted(client, app_modules, monkeypatch, status):
    runtime, run_id, calls = _queued_run(client, monkeypatch)
    store = app_modules["store"]
    store.update_graph_run(run_id, {"status": status})
    before = _snapshot(store, run_id)
    runtime.execute_run(run_id)
    assert _snapshot(store, run_id) == before and calls == []


@pytest.mark.parametrize("resume", [False, True])
def test_queued_and_resumed_startup_complete_normally(client, app_modules, monkeypatch, resume):
    runtime, run_id, calls = _queued_run(client, monkeypatch)
    store = app_modules["store"]
    if resume:
        store.update_graph_run(run_id, {"status": "running"})
    runtime.execute_run(run_id, resume=resume)
    after = _snapshot(store, run_id)
    assert calls == ["text"] and after["run"]["status"] == "completed"
    assert all(node["status"] == "completed" for node in after["nodes"])
    started = "run.resumed" if resume else "run.started"
    assert [event["event_type"] for event in after["events"]].count(started) == 1


def test_invalid_startup_still_fails_without_execution(client, app_modules, monkeypatch):
    from app.graph.schemas import GraphError, GraphValidationResult

    runtime, run_id, calls = _queued_run(client, monkeypatch)
    monkeypatch.setattr(importlib.import_module("app.graph.runtime"), "validate_workflow", lambda workflow: GraphValidationResult(valid=False, errors=[GraphError(code="invalid-test", message="Invalid regression input")]))
    runtime.execute_run(run_id)
    after = _snapshot(app_modules["store"], run_id)
    assert calls == [] and after["run"]["status"] == "failed"
    assert all(node["status"] == "skipped" for node in after["nodes"])
    assert [event["event_type"] for event in after["events"]].count("run.failed") == 1


def test_startup_state_and_events_rollback_together(client, app_modules, monkeypatch):
    runtime, run_id, calls = _queued_run(client, monkeypatch)
    module = importlib.import_module("app.store_graph")
    original = module.get_connection
    failed = False

    class ConnectionProxy:
        def __init__(self, connection): self.connection = connection
        def __getattr__(self, name): return getattr(self.connection, name)
        def execute(self, sql, parameters=()):
            nonlocal failed
            if not failed and sql.strip().upper().startswith("INSERT INTO GRAPH_RUN_EVENTS") and "run.started" in parameters:
                failed = True
                raise sqlite3.IntegrityError("Controlled startup event failure")
            return self.connection.execute(sql, parameters)

    @contextmanager
    def connection():
        with original() as current:
            yield ConnectionProxy(current)

    monkeypatch.setattr(module, "get_connection", connection)
    runtime.execute_run(run_id)
    final = _snapshot(app_modules["store"], run_id)
    events = [event["event_type"] for event in final["events"]]
    assert {
        "failure_injected": failed, "executor_calls": calls,
        "status": final["run"]["status"], "started_at": final["run"]["started_at"],
        "compiled_events": events.count("run.compiled"), "started_events": events.count("run.started"),
        "failed_events": events.count("run.failed"),
    } == {"failure_injected": True, "executor_calls": [], "status": "failed", "started_at": None, "compiled_events": 0, "started_events": 0, "failed_events": 1}
