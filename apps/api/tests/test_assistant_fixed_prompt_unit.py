"""Direct-run preset draft regressions; persistence and network are forbidden."""
import sys
from types import SimpleNamespace
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class FixedPromptDraftTests(unittest.TestCase):
    def setUp(self):
        bytecode = patch.object(sys, "dont_write_bytecode", True)
        bytecode.start()
        self.addCleanup(bytecode.stop)
        from app.assistant.preset_fields import validate_assistant_preset_fields
        from app.schemas import PresetUpsertRequest
        self.validate = validate_assistant_preset_fields
        self.draft = PresetUpsertRequest(
            key="fixed_teapot", label="Fixed Teapot", model_key="nano-banana-2",
            applies_to_models=["nano-banana-2"],
            prompt_template="A red ceramic teapot on a stone table in soft window light.",
            input_schema_json=[], input_slots_json=[],
            rules_json={"preset_lane": "text_to_image"},
        )

    def test_complete_fixed_prompt_needs_no_editable_fields_or_field_evidence(self):
        result = self.validate(self.draft, replaceable_elements=["teapot color"])
        self.assertTrue(result["passed"])
        self.assertEqual(result["field_count"], 0)
        self.assertEqual(self.draft.input_schema_json, [])

    def test_zero_fields_still_require_a_nonempty_prompt(self):
        for prompt in (None, "", "  "):
            with self.subTest(prompt=prompt), self.assertRaisesRegex(ValueError, "prompt"):
                type(self.draft).model_validate({**self.draft.model_dump(), "prompt_template": prompt})

    def propose(self, draft, summary_changes=None):
        from app.assistant import preset_kernel
        session = {"assistant_session_id": "fixed-test", "summary_json": {
            "reference_analysis_cache": {"style": {"reference_ids": ["style-image"],
                "goal": "preset_design", "analysis": {"replaceable_elements": ["teapot color"]}}}
        }}
        session["summary_json"].update(summary_changes or {})
        context = SimpleNamespace(session_id="fixed-test", session=session,
            user_text="Use this complete fixed prompt with no editable text fields.",
            artifact_intent="draft_preset")
        model = {"key": "nano-banana-2", "task_modes": ["text_to_image", "image_edit"],
            "input_patterns": ["prompt_only", "image_edit"],
            "raw": {"inputs": {"image": {"required_min": 0, "required_max": 14}}}}
        with patch.object(preset_kernel.kie_adapter, "list_models", return_value=[model]), patch.object(
            preset_kernel.store_assistant, "get_assistant_session", return_value=session
        ), patch.object(preset_kernel.store_assistant, "create_or_update_assistant_session", side_effect=lambda value: value):
            return preset_kernel.propose_media_preset_draft(
                preset_kernel.ProposeMediaPresetDraftArguments(draft=draft), context)

    def test_proposal_accepts_fixed_prompt_without_claiming_save_or_quality_verification(self):
        draft = self.draft.model_copy(update={"applies_to_task_modes": ["text_to_image"],
            "applies_to_input_patterns": ["prompt_only"]})
        result = self.propose(draft)
        self.assertEqual(result["draft"]["prompt_template"], draft.prompt_template)
        self.assertEqual(result["draft"]["input_schema_json"], [])
        self.assertEqual(result["quality_state"], "draft_ready")
        self.assertFalse(result["save_ready"])
        self.assertIsNone(result["confirmation_token"])

    def test_fixed_prompt_proposal_rejects_undefined_text_and_image_tokens(self):
        from app.assistant.preset_kernel import PresetKernelError
        for token in ("{{missing}}", "[[missing]]", "{{choice:color}}"):
            with self.subTest(token=token), self.assertRaises(PresetKernelError) as error:
                self.propose(self.draft.model_copy(update={"prompt_template": f"A teapot {token}."}))
            self.assertEqual(error.exception.code, "invalid_media_preset_draft")

    def test_zero_text_fields_does_not_bypass_image_lane_requirements(self):
        from app.assistant.preset_kernel import PresetKernelError
        draft = self.draft.model_copy(update={"rules_json": {"preset_lane": "image_to_image"},
            "applies_to_task_modes": ["image_edit"], "applies_to_input_patterns": ["image_edit"]})
        with self.assertRaises(PresetKernelError) as error:
            self.propose(draft)
        self.assertEqual(error.exception.code, "invalid_media_preset_slots")

    def test_fixed_image_preset_keeps_required_slot_role_and_generation_options(self):
        source = "Use Subject Image as the product shape source."
        draft = self.draft.model_copy(update={
            "prompt_template": "Use [[subject_image]] as the product shape source in soft window light.",
            "requires_image": True, "input_slots_json": [{"key": "subject_image", "label": "Subject Image", "required": True}],
            "applies_to_task_modes": ["image_edit"], "applies_to_input_patterns": ["image_edit"],
            "default_options_json": {"aspect_ratio": "4:3", "resolution": "1K"},
            "rules_json": {"preset_lane": "image_to_image", "runtime_image_roles": {
                "subject_image": {"role": "product shape source", "user_evidence": source}}},
        })
        result = self.propose(draft, {"kernel_preset_approvals": {"slot:subject_image": {
            "action": "approve", "label": "Subject Image", "role": "product shape source", "source_span": source}}})
        self.assertEqual(result["draft"]["input_schema_json"], [])
        self.assertEqual(result["draft"]["input_slots_json"], draft.input_slots_json)
        self.assertEqual(result["draft"]["default_options_json"], {"aspect_ratio": "4:3", "resolution": "1K"})
        self.assertEqual(result["lane_quality"]["runtime_slot_count"], 1)

    def test_zero_fields_cannot_silently_drop_a_previously_approved_field(self):
        from app.assistant.preset_kernel import PresetKernelError
        with self.assertRaises(PresetKernelError) as error:
            self.propose(self.draft, {"kernel_preset_approvals": {"field:color": {
                "action": "approve", "label": "Color", "source_span": "Add Color."}}})
        self.assertEqual(error.exception.code, "invalid_media_preset_fields")

    def test_existing_one_to_three_fields_keep_guidance_evidence_and_count_validation(self):
        fields = [{"key": f"color_{i}", "label": f"Teapot Color {i}", "placeholder": "e.g. red",
            "help_text": "Changes the visible teapot glaze color.", "required": True} for i in range(4)]
        for count in (1, 2, 3):
            with self.subTest(count=count):
                draft = self.draft.model_copy(update={"input_schema_json": fields[:count]})
                self.assertEqual(self.validate(draft)["field_count"], count)
                with self.assertRaisesRegex(ValueError, "field_evidence"):
                    self.validate(draft, replaceable_elements=["teapot color"])
        with self.assertRaisesRegex(ValueError, "at most three"):
            self.validate(self.draft.model_copy(update={"input_schema_json": fields}))
        bad = {**fields[0], "placeholder": "", "help_text": ""}
        with self.assertRaisesRegex(ValueError, "hint"):
            self.validate(self.draft.model_copy(update={"input_schema_json": [bad]}))


if __name__ == "__main__":
    with patch("sqlite3.connect", side_effect=AssertionError("Database forbidden")), patch(
        "socket.socket.connect", side_effect=AssertionError("Network forbidden")
    ):
        unittest.main()
