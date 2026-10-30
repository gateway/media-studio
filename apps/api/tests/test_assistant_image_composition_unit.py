"""Reference-analysis contract checks without database fixtures or real provider calls."""
import json
import unittest
from contextlib import ExitStack
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch

from app.assistant import reference_analysis as owner
from app.assistant.cancellation import AssistantRequestCancelled


class ImageCompositionTests(unittest.TestCase):
    def setUp(self):
        self.session = {"assistant_session_id": "owned", "summary_json": {}}
        self.context = SimpleNamespace(
            session_id="owned", session=self.session,
            attachments=[{"assistant_attachment_id": "attachment", "reference_id": "image", "kind": "image"}],
            timeout_seconds=None, cancel_event=Event(), provider_steps=[],
        )
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(owner.store_assistant, "get_assistant_session", return_value=self.session))
        self.save = self.stack.enter_context(patch.object(owner.store_assistant, "create_or_update_assistant_session", side_effect=self.remember))
        self.stack.enter_context(patch.object(owner, "_reference_paths", return_value=["/unused-image"]))
        self.stack.enter_context(patch.object(owner.Path, "read_bytes", return_value=b"original pixels"))
        self.stack.enter_context(patch.object(owner, "resolve_assistant_provider_runtime", return_value=SimpleNamespace(provider_kind="codex_local", provider_model_id="model")))
        self.content = self.stack.enter_context(patch.object(owner.enhancement_provider, "build_openai_compatible_multimodal_content", return_value="image input"))
        self.provider = self.stack.enter_context(patch.object(owner.enhancement_provider, "run_codex_local_chat", return_value={
            "generated_text": json.dumps({"palette": ["teal"], "uncertainties": ["Small text is unreadable."]}),
            "usage": {"prompt_tokens": 12, "completion_tokens": 8}, "latency_ms": 31,
        }))

    def remember(self, value):
        self.session.update(value)
        return self.session

    def analyze(self, **overrides):
        arguments = {"reference_ids": ["image"], "goal": "style_reference", "focus": "palette", "reference_roles": {"image": "style only"}, **overrides}
        return owner.analyze_reference_images(owner.AnalyzeReferenceImagesArguments(**arguments), self.context)

    def test_reuses_same_evidence_and_refreshes_changed_roles(self):
        first = self.analyze()
        self.assertEqual(first["analysis"]["uncertainties"], ["Small text is unreadable."])
        self.assertEqual(first["reference_roles"], {"image": "style only"})
        self.assertEqual(self.analyze()["cache_status"], "hit")
        self.assertEqual(self.provider.call_count, 1)
        changed = self.analyze(reference_roles={"image": "scene content"})
        self.assertEqual(changed["cache_status"], "miss")
        self.assertNotEqual(first["analysis_id"], changed["analysis_id"])
        self.assertEqual(self.provider.call_count, 2)
        self.assertIn("scene content", self.content.call_args.kwargs["text"])
        self.assertEqual(len(self.context.provider_steps), 2)
        self.assertEqual(self.context.provider_steps[0].latency_ms, 31)

    def test_rejects_roles_for_unselected_references_before_analysis(self):
        with self.assertRaises(owner.ReferenceAnalysisError) as error:
            self.analyze(reference_roles={"foreign-image": "style only"})
        self.assertEqual(error.exception.code, "reference_role_not_selected")
        self.provider.assert_not_called()
        self.save.assert_not_called()

    def test_cannot_reuse_evidence_after_attachment_ownership_changes(self):
        self.analyze()
        self.context.attachments[0]["assistant_attachment_id"] = "another-session-attachment"
        self.assertEqual(self.analyze()["cache_status"], "miss")
        self.context.attachments = []
        with self.assertRaises(owner.ReferenceAnalysisError) as error:
            self.analyze()
        self.assertEqual(error.exception.code, "reference_not_attached")
        self.assertEqual(self.provider.call_count, 2)

    def test_stop_during_nested_analysis_keeps_usage_without_saving_evidence(self):
        result = self.provider.return_value

        def stop_after_analysis(**_kwargs):
            self.context.cancel_event.set()
            return result

        self.provider.side_effect = stop_after_analysis
        with self.assertRaises(AssistantRequestCancelled):
            self.analyze()
        self.save.assert_not_called()
        self.assertEqual(self.session["summary_json"], {})
        self.assertEqual(self.context.provider_steps[0].usage["prompt_tokens"], 12)


if __name__ == "__main__":
    unittest.main()
