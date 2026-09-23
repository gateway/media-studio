"""Public planning turn/recovery tests with DB and provider access blocked."""
from __future__ import annotations
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

class PlanningRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch("sqlite3.connect", side_effect=AssertionError("Database forbidden")))
        self.stack.enter_context(patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")))
        from app.assistant import kernel
        from app import kie_adapter
        from app.graph.schemas import GraphWorkflow
        self.kernel = kernel
        self.workflow = GraphWorkflow(name="Storyboard proof", workflow_id="saved-graph")
        self.session = {"assistant_session_id": "recovery-test", "provider_kind": "codex_local", "summary_json": {}}
        for owner, name, value in [
            (kernel.store, "get_prompt_recipe_drafting_config", None),
            (kernel.store_assistant, "list_assistant_plans", []),
            (kernel.store_assistant, "latest_saved_assistant_artifact", None),
            (kernel.store_assistant, "recent_assistant_conversation", []),
            (kernel.store, "cache_graph_node_definitions", None),
            (kernel.store, "list_prompt_recipes", []),
            (kernel.store, "list_projects", []),
            (kernel.store, "list_presets", []),
            (kie_adapter, "list_models", []),
            (kie_adapter, "model_diagnostics", {}),
        ]:
            self.stack.enter_context(patch.object(owner, name, return_value=value))
        self.stack.enter_context(patch.object(kernel.store_assistant, "create_or_update_assistant_session", side_effect=self.remember))
        self.stack.enter_context(patch.object(kernel.store_assistant, "get_assistant_session", side_effect=lambda _: self.session))

    def remember(self, value):
        self.session.update(value)
        return dict(self.session)

    def test_repeated_policy_error_leaves_durable_recovery_without_running(self):
        step = {"capability": "general", "artifact_intent": "draft_recipe"}
        with patch.object(self.kernel, "run_kernel_provider_step", return_value=step):
            result = self.kernel.run_assistant_kernel_turn(session=self.session, user_text="Build nine-panel board", workflow=self.workflow, canvas_context={"workspace_key": "tab-proof"}, assistant_mode="graph")
        self.assertEqual(result.trace.termination, "repeated_no_progress")
        recovery = self.session["summary_json"]["kernel_planning_recovery"]
        self.assertEqual(recovery["state"], "offered")
        self.assertEqual(recovery["request"], "Build nine-panel board")
        self.assertEqual(result.next_action.kind, "none")
        self.assertIn("Continue planning", result.reply)

    def test_resume_retains_evidence_and_rejects_replay(self):
        from app.assistant.planning_recovery import continue_planning, record_planning_recovery
        from app.assistant.schemas import AssistantMessageCreateRequest
        from fastapi import HTTPException
        recovery = record_planning_recovery(session=self.session, workflow=self.workflow, canvas_context={"workspace_key": "tab-proof"}, request="Build nine-panel board", attachments=[{"assistant_attachment_id": "character"}], traces=[], messages=[{"role": "tool", "content": "saved recipe evidence"}], reason="step_budget_exhausted")
        payload = AssistantMessageCreateRequest(content_text="Continue planning", workflow=self.workflow, canvas_context={"workspace_key": "tab-proof"}, metadata={"planning_recovery_id": recovery["id"]})
        from unittest.mock import Mock
        def prepare_plan(session, request, checkpoint):
            self.remember({**session, "summary_json": {**session["summary_json"], "kernel_proposal_id": "fresh-plan"}})
            return self.session
        self.stack.enter_context(patch.object(self.kernel.store_assistant, "get_assistant_plan", return_value={"assistant_session_id": "recovery-test", "status": "validated"}))
        invoke = Mock(side_effect=prepare_plan)
        result = continue_planning(self.session, payload, [{"assistant_attachment_id": "character"}], invoke, None)
        self.assertEqual(result["summary_json"]["kernel_planning_recovery"]["state"], "completed")
        self.assertEqual(invoke.call_args.args[2]["messages"][0]["content"], "saved recipe evidence")
        self.assertIn("Do not apply, save, run", invoke.call_args.args[1].content_text)
        with self.assertRaises(HTTPException):
            continue_planning(self.session, payload, [{"assistant_attachment_id": "character"}], invoke, None)
        self.assertEqual(invoke.call_count, 1)

    def test_changed_graph_or_references_cannot_resume(self):
        from app.assistant.planning_recovery import continue_planning, record_planning_recovery
        from app.assistant.schemas import AssistantMessageCreateRequest
        from fastapi import HTTPException
        from unittest.mock import Mock
        recovery = record_planning_recovery(session=self.session, workflow=self.workflow, canvas_context={"workspace_key": "tab-proof"}, request="Build board", attachments=[{"assistant_attachment_id": "product"}], traces=[], messages=[], reason="step_budget_exhausted")
        payload = AssistantMessageCreateRequest(content_text="Continue", workflow=self.workflow, canvas_context={"workspace_key": "tab-proof"}, metadata={"planning_recovery_id": recovery["id"]})
        invoke = Mock()
        with self.assertRaises(HTTPException):
            continue_planning(self.session, payload, [], invoke, None)
        invoke.assert_not_called()

    def test_repeated_discovery_retains_completed_checks(self):
        step = {"capability": "graph_builder", "tool_call": {"name": "search_prompt_recipes", "arguments": {"query": "storyboard"}}}
        with patch.object(self.kernel, "run_kernel_provider_step", return_value=step):
            result = self.kernel.run_assistant_kernel_turn(session=self.session, user_text="Build board", workflow=self.workflow, canvas_context={"workspace_key": "tab-proof"}, assistant_mode="graph")
        self.assertEqual(result.trace.termination, "repeated_no_progress")
        self.assertEqual(result.trace.step_count, 3)
        recovery = self.session["summary_json"]["kernel_planning_recovery"]
        self.assertEqual(recovery["completed"], ["Searched saved recipes"])
        self.assertIn("search_prompt_recipes", recovery["messages"][0]["content"])

    def test_distinct_discovery_exceeds_old_limit_without_pause(self):
        steps = [{"capability": "graph_builder", "tool_call": {"name": "search_prompt_recipes", "arguments": {"query": f"recipe-{i}"}}} for i in range(9)]
        steps.append({"capability": "graph_builder", "reply": "No matching saved recipes; direct preparation is available."})
        with patch.object(self.kernel, "run_kernel_provider_step", side_effect=steps), patch.object(self.kernel.time, "perf_counter", side_effect=range(0, 100000, 200)):
            result = self.kernel.run_assistant_kernel_turn(session=self.session, user_text="Find the requested recipes", workflow=self.workflow, canvas_context={"workspace_key": "tab-proof"}, assistant_mode="graph")
        self.assertEqual(result.trace.termination, "completed")
        self.assertEqual(result.trace.step_count, 9)
        self.assertNotIn("Continue", result.reply)
        self.assertGreater(result.trace.duration_ms, 180000)

    def test_clarification_does_not_complete_recovery(self):
        from app.assistant.planning_recovery import continue_planning, record_planning_recovery
        from app.assistant.schemas import AssistantMessageCreateRequest
        recovery = record_planning_recovery(session=self.session, workflow=self.workflow, canvas_context={"workspace_key": "tab-proof"}, request="Build board", attachments=[], traces=[], messages=[], reason="step_budget_exhausted")
        payload = AssistantMessageCreateRequest(content_text="Continue", workflow=self.workflow, canvas_context={"workspace_key": "tab-proof"}, metadata={"planning_recovery_id": recovery["id"]})
        result = continue_planning(self.session, payload, [], lambda current, request, checkpoint: current, None)
        self.assertEqual(result["summary_json"]["kernel_planning_recovery"]["state"], "offered")
        self.assertNotEqual(result["summary_json"]["kernel_planning_recovery"]["id"], recovery["id"])

    def test_inspection_blocker_is_repaired_without_permission_question(self):
        recipe = {"recipe_id": "board", "key": "board", "label": "Board", "category": "image", "status": "active", "system_prompt_template": "Make nine panels"}
        steps = [
            {"capability": "graph_builder", "tool_call": {"name": "propose_graph_operations", "arguments": {"summary": "Prepare board", "template_id": "saved_recipe_image_v1", "recipe_id": "board"}}},
            {"capability": "graph_builder", "reply": "Shall I inspect it and continue?"},
            {"capability": "graph_builder", "tool_call": {"name": "get_prompt_recipe", "arguments": {"recipe_id_or_key": "board"}}},
            {"capability": "graph_builder", "reply": "The current recipe has been inspected; the image model choice is still needed."},
        ]
        with patch.object(self.kernel.store, "get_prompt_recipe", return_value=recipe), patch.object(self.kernel, "run_kernel_provider_step", side_effect=steps):
            result = self.kernel.run_assistant_kernel_turn(session=self.session, user_text="Prepare board", workflow=self.workflow, canvas_context={"workspace_key": "tab-proof"}, assistant_mode="graph")
        self.assertEqual([trace.tool_name for trace in result.trace.tool_calls], ["propose_graph_operations", "get_prompt_recipe"])
        self.assertNotIn("Shall I", result.reply)


    def test_stop_after_provider_prevents_tool_mutation(self):
        from threading import Event
        from app.assistant.cancellation import AssistantRequestCancelled
        event=Event()
        def stop(**kwargs):
            event.set()
            return {"capability":"graph_builder","tool_call":{"name":"search_prompt_recipes","arguments":{"query":"board"}}}
        with patch.object(self.kernel,"run_kernel_provider_step",side_effect=stop),patch.object(self.kernel,"execute_kernel_tool") as tool:
            with self.assertRaises(AssistantRequestCancelled) as caught:
                self.kernel.run_assistant_kernel_turn(session=self.session,user_text="Prepare board",workflow=self.workflow,canvas_context={},assistant_mode="graph",cancel_event=event)
            tool.assert_not_called()
            self.assertEqual(caught.exception.assistant_turn_trace["termination"],"cancelled")

    def test_failed_turn_preserves_prior_observed_usage(self):
        AssistantProviderChatError = self.kernel.AssistantProviderChatError
        from app.assistant.schemas import AssistantKernelProviderTrace
        calls=0
        def provider(**kwargs):
            nonlocal calls
            calls+=1
            kwargs["provider_steps"].append(AssistantKernelProviderTrace(usage={"prompt_tokens":30} if calls==1 else {}))
            if calls==2:
                error=AssistantProviderChatError("Disconnected")
                error.compaction_trace={"provider_steps":[{"compaction":{"count":1,"duration_ms":123,"outcome":"failed"}}],"provider_lifecycle":["thread_compaction_failed"]}
                raise error
            return {"capability":"graph_builder","tool_call":{"name":"search_prompt_recipes","arguments":{"query":"board"}}}
        with patch.object(self.kernel,"run_kernel_provider_step",side_effect=provider):
            with self.assertRaises(AssistantProviderChatError) as caught:
                self.kernel.run_assistant_kernel_turn(session=self.session,user_text="Find board",workflow=self.workflow,canvas_context={},assistant_mode="graph")
        trace=caught.exception.assistant_turn_trace
        self.assertEqual(trace["provider_steps"][0]["usage"]["prompt_tokens"],30)
        self.assertEqual(len(trace["tool_calls"]),1)
        self.assertIsNone(trace["provider_input_tokens"])
        self.assertIsNone(trace["provider_latency_ms"])
        self.assertEqual(trace["provider_steps"][-1]["compaction"]["duration_ms"],123)
        self.assertIn("thread_compaction_failed",trace["provider_lifecycle"])

if __name__ == "__main__":
    unittest.main()
