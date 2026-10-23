"""Recovery ownership through the real router/runtime/store; normal CI fixtures only."""
from concurrent.futures import ThreadPoolExecutor
import copy
import importlib
import threading
from types import SimpleNamespace

import pytest


def _prepare(client, app_modules, monkeypatch, *, interrupted=True):
    module = importlib.import_module("app.graph.runtime")
    from app.graph.schemas import GraphWorkflow

    workflow = GraphWorkflow(name="Recovery ownership", nodes=[
        {"id": "upstream", "type": "model.kie.nano_banana_pro", "fields": {"prompt": "Existing job", "resolution": "1K"}},
        {"id": "downstream", "type": "model.kie.nano_banana_pro", "fields": {"prompt": "One execution", "resolution": "1K"}},
    ])
    saved = client.post("/media/graph/workflows", json=workflow.model_dump(mode="json"))
    assert saved.status_code == 200, saved.text
    runtime, store = module.runtime, app_modules["store"]
    run = runtime.create_run(saved.json()["workflow_id"], workflow, start=False)
    batch, jobs = store.create_batch_and_jobs(
        {"status": "processing", "model_key": "nano-banana-pro", "task_mode": "text_to_image"},
        [{"model_key": "nano-banana-pro", "task_mode": "text_to_image", "status": "running", "provider_task_id": "ownership-existing-job"}],
    )
    job_id, batch_id = jobs[0]["job_id"], batch["batch_id"]
    store.append_graph_run_event(run.run_id, "kie.submitted", {"job_id": job_id, "batch_id": batch_id}, node_id="upstream")
    if interrupted:
        store.update_graph_run(run.run_id, {"status": "failed", "error": "Graph run was interrupted before completion."})
        store.update_graph_run_node(run.run_id, "upstream", {"status": "failed", "metrics_json": {"job_id": job_id, "batch_id": batch_id}})
    calls, adoptions, workers = [], [], []
    entered, release = threading.Event(), threading.Event()

    def adopt(**kwargs):
        adoptions.append(kwargs["job_id"])
        return {}

    def execute(node, context):
        calls.append(node.id)
        return {}

    class Worker(threading.Thread):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            workers.append(self)

    monkeypatch.setattr(module, "threading", SimpleNamespace(Thread=Worker, Lock=threading.Lock, RLock=threading.RLock))
    monkeypatch.setattr(module, "wait_for_existing_kie_job", adopt)
    monkeypatch.setattr(runtime.executors["model.kie"], "execute", execute)
    return SimpleNamespace(module=module, runtime=runtime, store=store, run_id=run.run_id, job_id=job_id,
                           calls=calls, adoptions=adoptions, workers=workers, entered=entered, release=release)


def _snapshot(case):
    return copy.deepcopy({"run": case.store.get_graph_run(case.run_id), "nodes": case.store.list_graph_run_nodes(case.run_id),
                          "events": case.store.list_graph_run_events(case.run_id)})


def _recover(client, case):
    response = client.post(f"/media/graph/runs/{case.run_id}/recover")
    assert response.status_code == 200, response.text
    return response.json()


def _finish(case):
    case.release.set()
    for worker in case.workers:
        worker.join(10)
    assert not any(worker.is_alive() for worker in case.workers)


def _assert_one_result(case):
    result = case.store.get_graph_run(case.run_id)
    events = case.store.list_graph_run_events(case.run_id)
    assert result["status"] == "completed"
    assert case.calls.count("downstream") == 1
    assert sum(event["event_type"] == "run.completed" for event in events) == 1
    assert sum(event["event_type"] == "node.completed" and event["node_id"] == "downstream" for event in events) == 1


@pytest.mark.parametrize("phase", ["polling", "downstream"])
def test_repeated_and_concurrent_recovery_keeps_one_worker(client, app_modules, monkeypatch, phase):
    case = _prepare(client, app_modules, monkeypatch)

    def adopt(**kwargs):
        case.adoptions.append(kwargs["job_id"])
        if phase == "polling":
            case.entered.set()
            assert case.release.wait(10)
        return {}

    def execute(node, context):
        case.calls.append(node.id)
        if phase == "downstream":
            case.entered.set()
            assert case.release.wait(10)
        return {}

    monkeypatch.setattr(case.module, "wait_for_existing_kie_job", adopt)
    monkeypatch.setattr(case.runtime.executors["model.kie"], "execute", execute)
    try:
        _recover(client, case)
        assert case.entered.wait(10)
        before = _snapshot(case)
        _recover(client, case)
        barrier = threading.Barrier(4)

        def recover_together():
            barrier.wait(10)
            return _recover(client, case)

        with ThreadPoolExecutor(max_workers=3) as pool:
            requests = [pool.submit(recover_together) for _ in range(3)]
            barrier.wait(10)
            for request in requests:
                request.result(10)
        assert _snapshot(case) == before
        assert len(case.workers) == 1
    finally:
        _finish(case)
    assert case.adoptions == [case.job_id]
    assert case.calls == ["downstream"]
    _assert_one_result(case)


def test_recovery_does_not_touch_an_active_original_worker(client, app_modules, monkeypatch):
    case = _prepare(client, app_modules, monkeypatch, interrupted=False)

    def execute(node, context):
        case.calls.append(node.id)
        if node.id == "upstream":
            case.entered.set()
            assert case.release.wait(10)
        return {}

    monkeypatch.setattr(case.runtime.executors["model.kie"], "execute", execute)
    try:
        case.runtime.start_run(case.run_id)
        assert case.entered.wait(10)
        before = _snapshot(case)
        _recover(client, case)
        _recover(client, case)
        assert _snapshot(case) == before
        assert len(case.workers) == 1
    finally:
        _finish(case)
    assert case.adoptions == []
    _assert_one_result(case)


def test_start_reserves_ownership_before_its_thread_is_scheduled(client, app_modules, monkeypatch):
    case = _prepare(client, app_modules, monkeypatch, interrupted=False)
    pending = []

    class DeferredWorker:
        def __init__(self, target, args=(), kwargs=None, **unused):
            self.target, self.args, self.kwargs = target, args, kwargs or {}

        def start(self):
            pending.append(self)

    monkeypatch.setattr(case.module.threading, "Thread", DeferredWorker)
    case.runtime.start_run(case.run_id)
    before = _snapshot(case)
    _recover(client, case)
    _recover(client, case)
    assert len(pending) == 1 and _snapshot(case) == before
    worker = pending[0]
    worker.target(*worker.args, **worker.kwargs)
    _assert_one_result(case)


def test_direct_resume_cannot_compete_with_an_existing_worker(client, app_modules, monkeypatch):
    case = _prepare(client, app_modules, monkeypatch)
    case.runtime.recover_run(case.run_id, start=False)

    def adopt(**kwargs):
        case.adoptions.append(kwargs["job_id"])
        case.entered.set()
        assert case.release.wait(10)
        return {}

    monkeypatch.setattr(case.module, "wait_for_existing_kie_job", adopt)
    first = case.module.threading.Thread(target=lambda: case.runtime.execute_run(case.run_id, resume=True))
    returned = threading.Event()

    def second_resume():
        case.runtime.execute_run(case.run_id, resume=True)
        returned.set()

    second = case.module.threading.Thread(target=second_resume)
    try:
        first.start()
        assert case.entered.wait(10)
        before = _snapshot(case)
        second.start()
        assert returned.wait(5), "competing resume did not return while the owner was paused"
        assert _snapshot(case) == before
    finally:
        _finish(case)
    assert case.adoptions == [case.job_id]
    _assert_one_result(case)


def test_new_runtime_recovers_an_orphan_and_completed_retry_is_a_noop(client, app_modules, monkeypatch):
    case = _prepare(client, app_modules, monkeypatch)
    restarted = case.module.GraphRuntime()
    monkeypatch.setattr(restarted.executors["model.kie"], "execute", lambda node, context: case.calls.append(node.id) or {})
    result = restarted.recover_run(case.run_id, start=False)
    assert result["recovered"] and not result["started"]
    restarted.execute_run(case.run_id, resume=True)
    _assert_one_result(case)
    assert case.adoptions == [case.job_id]
    before = _snapshot(case)
    assert not restarted.recover_run(case.run_id)["started"]
    assert _snapshot(case) == before


@pytest.mark.parametrize("entry", ["start", "recover"])
def test_thread_start_failure_releases_the_reservation(client, app_modules, monkeypatch, entry):
    case = _prepare(client, app_modules, monkeypatch, interrupted=entry == "recover")
    worker_type = case.module.threading.Thread

    class BrokenWorker:
        def __init__(self, **kwargs):
            pass

        def start(self):
            raise RuntimeError("Controlled thread start failure")

    monkeypatch.setattr(case.module.threading, "Thread", BrokenWorker)
    with pytest.raises(RuntimeError, match="Controlled thread start failure"):
        if entry == "recover":
            case.runtime.recover_run(case.run_id)
        else:
            case.runtime.start_run(case.run_id)
    monkeypatch.setattr(case.module.threading, "Thread", worker_type)
    if entry == "recover":
        _recover(client, case)
    else:
        case.runtime.start_run(case.run_id)
    _finish(case)
    _assert_one_result(case)


def test_exception_before_execution_releases_ownership(client, app_modules, monkeypatch):
    case = _prepare(client, app_modules, monkeypatch, interrupted=False)
    read = case.store.get_graph_run

    def unavailable(run_id):
        raise RuntimeError("Controlled store read failure")

    monkeypatch.setattr(case.store, "get_graph_run", unavailable)
    with pytest.raises(RuntimeError, match="Controlled store read failure"):
        case.runtime.execute_run(case.run_id)
    monkeypatch.setattr(case.store, "get_graph_run", read)
    case.runtime.execute_run(case.run_id)
    _assert_one_result(case)


@pytest.mark.parametrize("status", ["cancelling", "cancelled"])
def test_recovery_never_restarts_cancellation(client, app_modules, monkeypatch, status):
    case = _prepare(client, app_modules, monkeypatch)
    case.store.update_graph_run(case.run_id, {"status": status})
    _recover(client, case)
    assert case.workers == [] and case.calls == [] and case.adoptions == []
    assert case.store.get_graph_run(case.run_id)["status"] == "cancelled"
    before = _snapshot(case)
    _recover(client, case)
    assert _snapshot(case) == before


def test_cancellation_during_recovery_preparation_survives_worker_start(client, app_modules, monkeypatch):
    case = _prepare(client, app_modules, monkeypatch)
    case.store.update_graph_run(case.run_id, {"status": "running", "error": None})
    get_job, cancel = case.store.get_job, case.runtime.cancel_run
    pending = []
    cancelling = threading.Event()

    def paused_job(job_id):
        case.entered.set()
        assert case.release.wait(10)
        return get_job(job_id)

    def cancel_request(run_id):
        cancelling.set()
        return cancel(run_id)

    class DeferredWorker:
        def __init__(self, target, args=(), kwargs=None, **unused):
            self.target, self.args, self.kwargs = target, args, kwargs or {}

        def start(self):
            pending.append(self)

    monkeypatch.setattr(case.store, "get_job", paused_job)
    monkeypatch.setattr(case.runtime, "cancel_run", cancel_request)
    monkeypatch.setattr(case.module.threading, "Thread", DeferredWorker)
    with ThreadPoolExecutor(max_workers=2) as pool:
        recovery = pool.submit(_recover, client, case)
        try:
            assert case.entered.wait(10)
            cancellation = pool.submit(client.post, f"/media/graph/runs/{case.run_id}/cancel")
            assert cancelling.wait(10)
        finally:
            case.release.set()
        recovery.result(10)
        response = cancellation.result(10)
    assert response.status_code == 200 and response.json()["status"] == "cancelled"
    before = _snapshot(case)
    worker, = pending
    worker.target(*worker.args, **worker.kwargs)
    assert _snapshot(case) == before
    assert case.calls == [] and case.adoptions == []
