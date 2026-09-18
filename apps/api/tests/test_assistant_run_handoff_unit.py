"""No-DB confirmation regressions. Run this file directly with the shared Python.

Unlike the pytest harness, this suite blocks SQLite/network access and supplies
in-memory storage plus deterministic provider replies. It never starts the app.
"""
from __future__ import annotations

import sys
import hashlib
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class RunHandoffTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch("sqlite3.connect", side_effect=AssertionError("Database access forbidden")))
        self.stack.enter_context(patch("socket.socket.connect", side_effect=AssertionError("Network access forbidden")))
        # The pytest app fixture reloads app modules between tests. Bind the
        # current owners before patching so direct and full-suite runs agree.
        global kie_adapter, kernel, kernel_route, run_confirmation
        global AssistantMessageCreateRequest, AssistantRunConfirmationRequest, HTTPException, GraphWorkflow
        from app import kie_adapter
        from app.assistant import kernel, kernel_route, run_confirmation
        from app.assistant.schemas import AssistantMessageCreateRequest, AssistantRunConfirmationRequest
        from fastapi import HTTPException
        from app.graph.schemas import GraphWorkflow
        self.session = {"assistant_session_id": "handoff-test", "provider_kind": "codex_local", "summary_json": {}}
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
        self.stack.enter_context(patch.object(
            kernel.store_assistant, "create_or_update_assistant_session", side_effect=self.remember_session,
        ))

        self.stack.enter_context(patch.object(
            kernel.store_assistant, "claim_assistant_run_confirmation", side_effect=self.claim_confirmation,
        ))

    def claim_confirmation(self, session_id, token_hash, update):
        summary = self.session["summary_json"]
        confirmation = summary.get("kernel_run_confirmation") or {}
        if confirmation.get("consumed") or confirmation.get("confirmation_token_hash") != token_hash:
            return False
        summary.update(update)
        return True

    def remember_session(self, record):
        self.session.update(record)
        return dict(self.session)

    def turn(self, reply):
        steps = [
            {"capability": "graph_builder", "tool_call": {
                "name": "validate_current_workflow", "arguments": {"request_run_confirmation": True},
            }},
            {"capability": "graph_builder", **reply},
        ]
        with patch.object(kernel, "run_kernel_provider_step", side_effect=steps):
            return kernel.run_assistant_kernel_turn(
                session=self.session, user_text="Prepare confirmation, do not run.",
                workflow=GraphWorkflow(name="Confirmation proof", workflow_id="workflow-proof"), canvas_context={}, assistant_mode="graph",
            )

    def message_turn(self, reply, capability="graph_builder"):
        messages = []
        self.stack.enter_context(patch.object(kernel.store_assistant, "list_assistant_messages", return_value=messages))
        self.stack.enter_context(patch.object(kernel.store_assistant, "get_assistant_session", side_effect=lambda _: dict(self.session)))
        self.stack.enter_context(patch.object(
            kernel.enhancement_provider.codex_local_provider, "close_codex_local_skill_session", return_value=None,
        ))
        def add_message(record):
            record = {**record, "assistant_message_id": f"message-{len(messages)}"}
            messages.append(record)
            return record
        self.stack.enter_context(patch.object(kernel.store_assistant, "create_assistant_message", side_effect=add_message))
        steps = [
            {"capability": capability, "tool_call": {
                "name": "validate_current_workflow", "arguments": {"request_run_confirmation": True},
            }},
            {"capability": capability, **reply},
        ]
        with patch.object(kernel, "run_kernel_provider_step", side_effect=steps):
            kernel_route.create_kernel_message(
                session=self.session, attachments=[], payload=AssistantMessageCreateRequest(
                    content_text="Prepare a new confirmation, do not run.",
                    workflow=GraphWorkflow(name="Confirmation proof", workflow_id="workflow-proof"), assistant_mode="graph",
                ),
            )
        return messages[-1]

    def test_new_graph_proposal_retires_only_an_unused_recipe_offer(self):
        from app.assistant.schemas import AssistantKernelTurnResult, AssistantKernelTrace, AssistantNextAction
        for state in ["offered", "awaiting_save", "returning"]:
            with self.subTest(state=state):
                self.session["summary_json"] = {"kernel_recipe_continuation": {"id": "old-offer", "state": state}}
                result = AssistantKernelTurnResult(reply="Graph ready for review.", capability="graph_builder", trace=AssistantKernelTrace(capability="graph_builder"), next_action=AssistantNextAction(kind="confirm_graph", proposal_id="new-plan"))
                with patch.object(kernel_route, "run_assistant_kernel_turn", return_value=result):
                    self.message_turn({"reply": "Ready."})
                self.assertEqual(self.session["summary_json"]["kernel_recipe_continuation"]["state"], "cancelled" if state == "offered" else state)

    def test_executable_confirmation_does_not_repeat_provider_claim_that_it_is_blocked(self):
        message = self.message_turn({"reply": "Confirmation is blocked because no token was returned."})
        self.assertEqual(message["content_json"]["next_action"]["kind"], "run_workflow")
        self.assertNotIn("blocked", message["content_text"])
        self.assertIn("Nothing has started", message["content_text"])

    def test_new_confirmation_replaces_consumed_action_and_rejects_stale_or_foreign_inputs(self):
        self.session["summary_json"] = {"kernel_run_confirmation": {
            "consumed": True, "confirmation_token_hash": hashlib.sha256(b"old-token").hexdigest(),
        }}
        message = self.message_turn({"reply": "Ready."})
        action = message["content_json"]["next_action"]
        self.assertEqual(action["kind"], "run_workflow")
        self.assertFalse(self.session["summary_json"]["kernel_run_confirmation"]["consumed"])
        workflow = GraphWorkflow(name="Confirmation proof", workflow_id="workflow-proof")
        for token, graph in [
            ("old-token", workflow),
            (action["confirmation_token"], GraphWorkflow(name="Another graph", workflow_id="other-workflow")),
        ]:
            with self.assertRaises(HTTPException):
                run_confirmation.confirm_kernel_run_action("handoff-test", AssistantRunConfirmationRequest(
                    workflow=graph, confirmation_token=token,
                ))
        payload = AssistantRunConfirmationRequest(workflow=workflow, confirmation_token=action["confirmation_token"])
        self.assertEqual(run_confirmation.confirm_kernel_run_action("handoff-test", payload), {"confirmed": True})
        with self.assertRaises(HTTPException):
            run_confirmation.confirm_kernel_run_action("handoff-test", payload)

    def test_submission_losing_atomic_confirmation_claim_cannot_start(self):
        message = self.message_turn({"reply": "Ready."})
        action = message["content_json"]["next_action"]
        workflow = GraphWorkflow(name="Confirmation proof", workflow_id="workflow-proof")
        self.stack.enter_context(patch.object(kernel.store, "get_graph_run", return_value={
            "run_id": "losing-run", "workflow_json": workflow.model_dump(mode="json"),
        }))
        self.stack.enter_context(patch.object(
            kernel.store_assistant, "claim_assistant_run_confirmation", return_value=False,
        ))
        with self.assertRaises(run_confirmation.RunEvidenceError):
            run_confirmation.associate_confirmed_assistant_run(
                "handoff-test", "losing-run", AssistantRunConfirmationRequest(
                    workflow=workflow, confirmation_token=action["confirmation_token"],
                ),
            )

    def test_pricing_failure_is_a_blocker_not_a_ready_confirmation(self):
        with patch.object(kernel, "estimate_graph_workflow", side_effect=ValueError("pricing unavailable")):
            message = self.message_turn({"reply": "Ready for review."})
        self.assertEqual(message["content_json"]["next_action"]["kind"], "none")
        self.assertIn("pricing", message["content_text"].lower())
        self.assertNotIn("Ready for review", message["content_text"])

    def test_saved_recipe_and_preset_confirmations_keep_their_kind(self):
        workflow = GraphWorkflow(name="Confirmation proof", workflow_id="workflow-proof")
        for capability, template, expected_kind in [
            ("recipe_builder", "saved_recipe_image_v1", "recipe"),
            ("preset_builder", "preset_style_t2i_sandbox_v1", "preset_test"),
        ]:
            with self.subTest(capability=capability):
                plan = {
                    "assistant_plan_id": "plan-proof", "assistant_session_id": "handoff-test",
                    "status": "applied", "applied_workflow_id": "workflow-proof",
                    "plan_json": {"metadata": {"template_id": template}},
                    "workflow_json": workflow.model_dump(mode="json"),
                }
                self.session["summary_json"] = {"kernel_proposal_id": "plan-proof"}
                with patch.object(kernel.store_assistant, "list_assistant_plans", return_value=[plan]), patch.object(
                    kernel.store_assistant, "get_assistant_plan", return_value=plan,
                ):
                    message = self.message_turn({"reply": "Ready."}, capability)
                    self.assertEqual(message["content_json"]["next_action"]["kind"], "run_workflow")
                    self.assertEqual(self.session["summary_json"]["kernel_run_confirmation"]["confirmation_kind"], expected_kind)

    def test_validated_intent_survives_provider_omitting_confirmation_flag(self):
        result = self.turn({"reply": "Ready for review.", "requested_action": {"kind": "run_workflow"}})
        self.assertEqual(result.next_action.kind, "run_workflow")
        self.assertTrue(result.next_action.requires_confirmation)
        self.assertTrue(result.next_action.confirmation_token)
        self.assertEqual(result.next_action.confirmation_token, result.next_action.payload["confirmation_token"])


if __name__ == "__main__":
    unittest.main()
