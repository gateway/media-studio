"""Direct-run regressions: all imports and cases deny DB/network access."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

def board(count=6):
    return "BOARD TITLE: Neutral prop study\nPROJECT: Neutral\nSEQUENCE: Study\nLOCATION: Studio\nDATE:\nARTIST:\nStoryboard. PANEL COUNT: %s\n" % count + "\n".join(
        f"PANEL {i}:\nSHOT: PROP REVEAL\nCAMERA: Eye-level static 50mm lens\nACTION: The performer releases the spoon before lifting the weight.\nMOTION: The camera creeps closer.\nDIALOG: \nNOTES: Keep the bottle upright and open."
        for i in range(1, count + 1))

class GenerationContractTests(unittest.TestCase):
    def test_long_prompts_are_exact_under_limit(self):
        from app.graph.prompt_shaping import shape_kie_graph_prompt
        for kind in ("Product sheet", "Character reference", "Environment sheet"):
            text = kind + "\n" + "Keep all observed details. " * 240 + "\nTAIL: Do not invent packaging or remove the final constraint."
            shaped = shape_kie_graph_prompt("gpt-image-2-image-to-image", text, max_chars=20000)
            self.assertEqual(shaped.prompt, text)
            self.assertFalse(shaped.changed)

    def test_hard_limit_fails_without_rewrite(self):
        from app.graph.prompt_shaping import shape_kie_graph_prompt
        with self.assertRaisesRegex(ValueError, "limit"):
            shape_kie_graph_prompt("gpt-image-2-image-to-image", "x" * 201, max_chars=200)

    def test_complete_clauses_and_markdown_panel_adapters(self):
        from app.graph.storyboard_sheet_spec import storyboard_sheet_spec_from_recipe_result
        from app.graph.storyboard_metadata_preflight import validate_storyboard_metadata_preflight
        for count in (4, 6, 9):
            for text in (board(count), board(count).replace("PANEL ", "### PANEL ").replace("ACTION:", "- **ACTION:**")):
                spec = storyboard_sheet_spec_from_recipe_result({"raw_text": text})
                self.assertEqual(len(spec.panels), count)
                self.assertEqual(spec.panels[-1].motion, "The camera creeps closer.")
                self.assertEqual(validate_storyboard_metadata_preflight(model_key="gpt-image-2", original_prompt=text, submitted_prompt=text).panel_count,count)

    def test_compiler_preserves_tail_constraints_and_dialogue(self):
        from app.graph.storyboard_sheet_spec import storyboard_sheet_spec_from_recipe_result, storyboard_art_prompt
        text = board().replace("The camera creeps closer.", "The camera holds steady.")
        text = "REFERENCE AUTHORITY: Original images govern identity. Do not invent hidden packaging.\nPROP AND STATE CONTINUITY: Release the spoon before touching the weight.\n" + text
        text = text.replace("DIALOG: ", 'DIALOG: "Keep every word of this exact spoken sentence, including its final words and punctuation."', 1)
        spec = storyboard_sheet_spec_from_recipe_result({"raw_text": text})
        prompt = storyboard_art_prompt(spec)
        self.assertNotIn("text-free", prompt)
        self.assertIn("Preserve text, lettering and logos physically present", prompt)
        for value in spec.visual_context.values(): self.assertIn(value, prompt)
        for panel in spec.panels:
            for value in (panel.action, panel.motion, panel.notes, panel.dialog): self.assertIn(value, prompt)

    def test_declared_and_requested_counts_cannot_silently_shrink(self):
        from app.graph.storyboard_sheet_spec import storyboard_sheet_spec_from_recipe_result
        for payload in ({"raw_text":board(4).replace("PANEL COUNT: 4", "PANEL COUNT: 6")}, {"raw_text":board(4),"panel_count":6}, {"raw_text":board(4).replace("PANEL COUNT: 4", "SHOT COUNT: 6")}):
            with self.assertRaisesRegex(ValueError,"expected 6 panels"):
                storyboard_sheet_spec_from_recipe_result(payload)

    def test_timing_and_panel_bound_dialogue_survive_roundtrip(self):
        from app.graph.storyboard_sheet_spec import storyboard_sheet_spec_from_recipe_result, storyboard_sheet_spec_from_mapping, storyboard_art_prompt
        text=board()
        for n in range(1,7): text=text.replace(f"PANEL {n}:",f"{n}. PANEL {n} IMAGE AND METADATA ({n-1}–{n}s):")
        spec=storyboard_sheet_spec_from_recipe_result({"raw_text":text})
        restored=storyboard_sheet_spec_from_mapping(spec.to_dict())
        for n,panel in enumerate(restored.panels,1):
            self.assertEqual(panel.time_range,f"{n-1}–{n}s")
            self.assertIn(panel.time_range,storyboard_art_prompt(restored))
        wrong=text.replace("DIALOG: ",'DIALOG: "Exact final words."',1)
        with self.assertRaisesRegex(ValueError,"Panel 06"):
            storyboard_sheet_spec_from_recipe_result({"raw_text":wrong,"dialogue_cues":'PANEL 06: "Exact final words."'})

    def test_compositor_accepts_blank_production_values_and_preserves_timing(self):
        from PIL import Image
        from app.graph.storyboard_sheet_spec import storyboard_sheet_spec_from_recipe_result
        from app.graph.storyboard_sheet_renderer import render_storyboard_sheet
        for count in (4,6,9):
            text=board(count)
            for n in range(1,count+1): text=text.replace(f"PANEL {n}:",f"PANEL {n}, {n-1}–{n}s:")
            spec=storyboard_sheet_spec_from_recipe_result({"raw_text":text})
            rendered=render_storyboard_sheet([Image.new("RGB",(300,180),"gray") for _ in range(count)],spec)
            self.assertEqual(rendered.metadata["panel_count"],count)
            self.assertIn("0–1s",str(rendered.metadata))

    def test_compiled_source_remains_compatible_with_consumers(self):
        from app.graph.storyboard_sheet_spec import storyboard_sheet_spec_from_recipe_result, storyboard_art_prompt, storyboard_art_source_prompt_is_compatible
        from app.graph.storyboard_metadata_preflight import _looks_like_text_free_storyboard_art_source
        for count in (4,6,9):
            prompt=storyboard_art_prompt(storyboard_sheet_spec_from_recipe_result({"raw_text":board(count)}))
            self.assertTrue(storyboard_art_source_prompt_is_compatible(prompt,panel_count=count))
            self.assertTrue(_looks_like_text_free_storyboard_art_source(prompt))
            legacy=prompt.replace("source plate without editorial text overlays", "source plate").replace("Create one ", "Create one text-free ").replace("Show scene art only", "Show art only")
            self.assertTrue(storyboard_art_source_prompt_is_compatible(legacy,panel_count=count))
            self.assertTrue(_looks_like_text_free_storyboard_art_source(legacy))
            self.assertFalse(storyboard_art_source_prompt_is_compatible(prompt,panel_count=9 if count!=9 else 4))

    def test_malformed_rows_still_fail(self):
        from app.graph.storyboard_sheet_spec import storyboard_sheet_spec_from_recipe_result
        for text in (board().replace("PANEL 6:", "PANEL 5:"), board().replace("ACTION: The performer releases the spoon before lifting the weight.", "ACTION:"), board().replace("NOTES: Keep the bottle upright and open.", "NOTES: Keep the")):
            with self.assertRaises(ValueError): storyboard_sheet_spec_from_recipe_result({"raw_text":text})

if __name__ == "__main__":
    with patch("sqlite3.connect", side_effect=AssertionError("Database forbidden")), patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")):
        unittest.main()
