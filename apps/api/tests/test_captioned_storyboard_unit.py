"""Pure prompt contract regressions; safe to run directly without the DB harness."""
from __future__ import annotations
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

class CaptionedStoryboardTests(unittest.TestCase):
    def test_timed_captioned_board_preserves_every_beat_before_submission(self):
        with patch("sqlite3.connect", side_effect=AssertionError("Database forbidden")), patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")):
            from app.graph.prompt_shaping import shape_kie_graph_prompt
            from app.graph.storyboard_metadata_preflight import validate_storyboard_metadata_preflight
            prompt = "Create a nine-panel storyboard. PANEL COUNT: 9.\n" + "\n".join(
                f"Panel {i}, {i-1}–{i}s: The performer reveals prop {i}. " + "Keep the bottle label and character consistent. " * 12 + f"\nCaption: Medium shot — reveal number {i}."
                for i in range(1, 10)
            )
            shaped = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, max_chars=20000)
            self.assertEqual(shaped.prompt, prompt)
            result = validate_storyboard_metadata_preflight(model_key="gpt-image-2-image-to-image", original_prompt=prompt, submitted_prompt=shaped.prompt)
            self.assertEqual(result.panel_count, 9)

    def test_missing_duplicate_and_empty_caption_panels_fail_before_spend(self):
        from app.graph.storyboard_metadata_preflight import validate_storyboard_metadata_preflight
        original = "Storyboard. PANEL COUNT: 2\nPanel 1, 0–2s: A cup lands.\nCaption: Wide — cup lands.\nPanel 2, 2–4s: The host smiles.\nCaption: Close — host smiles."
        for malformed in [original.split("Panel 2")[0], original.replace("Panel 2", "Panel 1"), original.replace("Caption: Close — host smiles.", "Caption:"), original.replace("Panel 2, 2–4s:", "Panel x:")]:
            with self.subTest(prompt=malformed), self.assertRaises(ValueError):
                validate_storyboard_metadata_preflight(model_key="gpt-image-2-image-to-image", original_prompt=original, submitted_prompt=malformed)

    def test_declared_metadata_never_uses_caption_contract(self):
        from app.graph.storyboard_metadata_preflight import validate_storyboard_metadata_preflight
        prompt = "Storyboard. PANEL COUNT: 1\nPanel 1, 0–2s: A cup lands.\nCaption: Wide — cup lands."
        with self.assertRaisesRegex(ValueError, "SHOT row count"):
            validate_storyboard_metadata_preflight(model_key="gpt-image-2-image-to-image", original_prompt=prompt, submitted_prompt=prompt, prompt_semantics="storyboard_sheet_with_metadata")

    def test_canonical_metadata_with_timing_keeps_strict_rows(self):
        from app.graph.storyboard_metadata_preflight import validate_storyboard_metadata_preflight
        prompt = "Storyboard. PANEL COUNT: 1\nPanel 1, 0–2s:\nSHOT: CUP REVEAL\nCAMERA: Eye-level static 50mm lens\nACTION: The host places a cup on the counter.\nMOTION: The camera holds steady.\nDIALOG:\nNOTES: Preserve the red label and established lighting."
        result = validate_storyboard_metadata_preflight(model_key="gpt-image-2-image-to-image", original_prompt=prompt, submitted_prompt=prompt)
        self.assertEqual(result.panel_count, 1)
        with self.assertRaisesRegex(ValueError, "CAMERA row count"):
            validate_storyboard_metadata_preflight(model_key="gpt-image-2-image-to-image", original_prompt=prompt, submitted_prompt=prompt.replace("CAMERA:", "Caption:"))

if __name__ == "__main__":
    unittest.main()
