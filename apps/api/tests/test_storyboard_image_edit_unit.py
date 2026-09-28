"""Run directly: all database access, network access and provider submission denied."""
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class StoryboardEditTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch("sqlite3.connect", side_effect=AssertionError("Database forbidden")))
        self.stack.enter_context(patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")))
        from app.graph.schemas import GraphWorkflow
        self.prompt = (Path(__file__).parent / "fixtures/storyboard_lighting_edit.txt").read_text()
        self.workflow = GraphWorkflow.model_validate({"name": "Existing image edit", "nodes": [
            {"id": "original", "type": "media.load_image", "fields": {"asset_id": "asset_2b5fd357d7fd"}},
            {"id": "image", "type": "model.kie.test", "fields": {
                "prompt": self.prompt, "resolution": "2K", "aspect_ratio": "16:9"}},
        ], "edges": [{"id": "source", "source": "original", "source_port": "image",
                       "target": "image", "target_port": "image_refs"}]})
        definition = SimpleNamespace(source={"model_key": "gpt-image-2-5-sunburst-image-to-image",
            "task_modes": ["image_edit", "text_to_image"], "output_media_type": "image"},
            fields=[SimpleNamespace(id=key) for key in ("prompt", "resolution", "aspect_ratio")])
        for target, value in [
            ("app.graph.executors.kie_model.registry.get_definition", definition),
            ("app.service_prompt_budget.model_prompt_max_chars", 20000),
            ("app.store.get_asset", {"generation_kind": "image"}),
        ]:
            self.stack.enter_context(patch(target, return_value=value))
        self.stack.enter_context(patch("app.service.submit_jobs", side_effect=AssertionError("Submission forbidden")))
        self.stack.enter_context(patch("app.graph.normalization.materialize_workflow_defaults", side_effect=lambda w: w))
        self.stack.enter_context(patch("app.assistant.provenance.workflow_fingerprint", return_value="unchanged"))
        self.stack.enter_context(patch("app.service.build_validation_bundle", side_effect=lambda r: {
            "final_prompt": r.prompt, "preflight": {"can_submit": True}}))

    def prepare(self):
        from app.graph.executors.base import GraphExecutionContext
        from app.graph.executors.media_load import LoadImageExecutor
        from app.graph.executors.kie_model import KieModelExecutor
        from app.graph.executors.prompt_ops import PromptTextExecutor
        context = GraphExecutionContext("", self.workflow)
        for node in self.workflow.nodes:
            if node.type == "media.load_image":
                context.publish_outputs(node, LoadImageExecutor().execute(node, context))
            elif node.type == "prompt.text":
                context.publish_outputs(node, PromptTextExecutor().execute(node, context))
        return KieModelExecutor().prepare_request(self.workflow.nodes[1], context), context

    def test_recorded_edit_preserves_exact_prompt_source_and_options(self):
        self.assertEqual(len(self.prompt), 2235)
        self.assertIn('panel 1 HOST', self.prompt)
        self.assertIn('panel 6 HOST', self.prompt)
        request, context = self.prepare()
        self.assertEqual(request.prompt, self.prompt)
        self.assertEqual([i.asset_id for i in request.images], ["asset_2b5fd357d7fd"])
        self.assertEqual(request.options, {"resolution": "2K", "aspect_ratio": "16:9"})
        self.assertFalse(context.node_metrics["image"]["provider_submitted"])

    def test_connected_edit_has_the_same_preparation_as_inline_edit(self):
        from app.graph.schemas import GraphWorkflowNode, GraphWorkflowEdge
        inline, _ = self.prepare()
        self.workflow.nodes.append(GraphWorkflowNode(id="prompt", type="prompt.text", fields={"text": self.prompt}))
        self.workflow.nodes[1].fields.pop("prompt")
        self.workflow.edges.append(GraphWorkflowEdge(id="p", source="prompt", source_port="text", target="image", target_port="prompt"))
        connected, context = self.prepare()
        self.assertEqual(connected.model_dump(), inline.model_dump())
        self.assertEqual(context.node_metrics["image"]["prompt_semantics"], "existing_image_edit")

    def test_new_storyboard_with_or_without_image_references_is_still_validated(self):
        for include_image in (True, False):
            with self.subTest(include_image=include_image):
                if not include_image:
                    self.workflow.edges.clear()
                self.workflow.nodes[1].fields["prompt"] = (
                    "Create a new storyboard production sheet. PANEL COUNT: 6\n"
                    "PANEL 01\nSHOT: Opening shot\nCAMERA: Eye-level 50mm static\n"
                    "ACTION: The host lifts the mug.\nMOTION: He smiles.\nDIALOG: ")
                with self.assertRaisesRegex(ValueError, "Storyboard preflight failed"):
                    self.prepare()

    def test_edit_without_source_image_does_not_bypass_storyboard_validation(self):
        self.workflow.edges.clear()
        with self.assertRaisesRegex(ValueError, "panel sequence is empty"):
            self.prepare()

    def test_explicit_recipe_contract_is_not_overridden_by_edit_wording(self):
        from app.graph.storyboard_metadata_preflight import resolve_image_prompt_semantics, validate_storyboard_metadata_preflight
        semantics = resolve_image_prompt_semantics(self.prompt, has_images=True,
            prompt_semantics="storyboard_sheet_with_metadata")
        with self.assertRaisesRegex(ValueError, "panel sequence is empty"):
            validate_storyboard_metadata_preflight(model_key="gpt-image-2", original_prompt=self.prompt,
                submitted_prompt=self.prompt, prompt_semantics=semantics)

    def test_human_edit_wording_works_inline_and_connected(self):
        from app.graph.schemas import GraphWorkflowNode, GraphWorkflowEdge
        for prompt in (
            "Make this existing storyboard a nighttime scene. Keep panel 1 and panel 6 exactly as they are; change only the lighting.",
            "Edit the original storyboard image. Make panel 1 nighttime and preserve everything else.",
            "Make this selected storyboard a nighttime scene; preserve panel 1 and panel 6.",
            "Edit the original storyboard image. Preserve panel 1 and panel 6. Do not create a new storyboard; change only the lighting.",
        ):
            with self.subTest(prompt=prompt):
                self.workflow.nodes[1].fields["prompt"] = prompt
                inline, _ = self.prepare()
                text = GraphWorkflowNode(id="prompt", type="prompt.text", fields={"text": prompt})
                edge = GraphWorkflowEdge(id="p", source="prompt", source_port="text", target="image", target_port="prompt")
                self.workflow.nodes.append(text)
                self.workflow.edges.append(edge)
                connected, _ = self.prepare()
                self.assertEqual(inline.model_dump(), connected.model_dump())
                self.workflow.nodes.pop()
                self.workflow.edges.pop()

    def test_creating_a_new_board_from_an_existing_image_still_checks_its_script(self):
        self.workflow.nodes[1].fields["prompt"] = (
            "Edit the supplied storyboard image. Preserve the existing character and layout, "
            "but create a new six-panel storyboard. Put the host outdoors in panel 1 and indoors in panel 6."
        )
        with self.assertRaisesRegex(ValueError, "panel sequence is empty"):
            self.prepare()

    def test_connected_explicit_art_only_storyboard_remains_supported(self):
        from app.graph.schemas import GraphWorkflowNode, GraphWorkflowEdge
        prompt = "Create a six-panel storyboard. Do not render text, titles, captions, labels, or production metadata. "
        prompt += " ".join(f"PANEL {i} — Show visual beat {i}." for i in range(1, 7))
        self.workflow.nodes.append(GraphWorkflowNode(id="prompt", type="prompt.text", fields={"text": prompt}))
        self.workflow.edges.append(GraphWorkflowEdge(id="p", source="prompt", source_port="text", target="image", target_port="prompt"))
        request, _ = self.prepare()
        self.assertEqual(request.prompt, prompt)

    def test_connected_new_storyboard_is_not_exempt_as_user_authored(self):
        from app.graph.schemas import GraphWorkflowNode, GraphWorkflowEdge
        self.workflow.nodes.append(GraphWorkflowNode(id="prompt", type="prompt.text", fields={
            "text": "Create a storyboard. PANEL COUNT: 6"}))
        self.workflow.edges.append(GraphWorkflowEdge(id="p", source="prompt", source_port="text", target="image", target_port="prompt"))
        for with_image in (True, False):
            with self.subTest(with_image=with_image):
                if not with_image:
                    self.workflow.edges = [e for e in self.workflow.edges if e.id != "source"]
                with self.assertRaisesRegex(ValueError, "panel sequence is empty"):
                    self.prepare()

    def test_review_uses_the_same_selected_image_and_preserves_the_workflow(self):
        from app.assistant.generation_inspection import _prepare_current, InspectGenerationArguments
        before = self.workflow.model_dump()
        result = _prepare_current(InspectGenerationArguments(node_id="image"), SimpleNamespace(workflow=self.workflow))
        self.assertEqual(result["ordered_images"], [{"asset_id": "asset_2b5fd357d7fd"}])
        self.assertEqual(result["prompt"]["text"], self.prompt)
        self.assertEqual(result["options"], {"resolution": "2K", "aspect_ratio": "16:9"})
        self.assertEqual(self.workflow.model_dump(), before)
        self.assertFalse(result["provider_submitted"])

    def test_review_distinguishes_pending_unknown_and_rejected_inputs(self):
        from app.assistant.generation_inspection import review_workflow_generation
        for can_submit, expected in ((None, "pending"), (False, "blocked"), (True, "ready")):
            with self.subTest(can_submit=can_submit), patch("app.service.build_validation_bundle", return_value={
                "preflight": {"can_submit": can_submit, "reason": "Provider input contract"}}):
                self.assertEqual(review_workflow_generation(self.workflow)["status"], expected)
        self.workflow.nodes[0].type = "prompt.recipe"
        self.assertEqual(review_workflow_generation(self.workflow)["status"], "pending")
        self.workflow.nodes[1].metadata = {"execution": {"mode": "muted"}}
        self.assertEqual(review_workflow_generation(self.workflow)["nodes"], [])

    def test_run_review_reports_real_preflight_error_without_submission(self):
        from app.assistant.generation_inspection import review_workflow_generation
        self.workflow.nodes[1].fields["prompt"] = "Create a storyboard. PANEL COUNT: 6"
        review = review_workflow_generation(self.workflow)
        self.assertEqual(review["status"], "blocked")
        self.assertIn("panel sequence is empty", review["nodes"][0]["reason"])
        self.assertFalse(review["provider_submitted"])


if __name__ == "__main__":
    unittest.main()
