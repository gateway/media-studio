"""Offline recipe/data-update and compiler checks; no database or provider access."""
import copy
import socket
import sqlite3
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
RECIPE_ID = "prompt-recipe-storyboard-v2-gpt-image-2"


def seeded_recipes(module):
    rows = {}
    connection = Mock()
    connection.execute.return_value.fetchone.return_value = None
    with patch.object(module, "insert_or_update", side_effect=lambda _, _table, key, row: rows.update({row[key]: row})), patch.object(module, "utcnow_iso", return_value="fixed"):
        module.seed_default_prompt_recipes(connection)
    return rows


def multi_action_result(count):
    states = " ".join(
        f"Frame {n:02d} shows the ceramicist beside the upright vase after the inspection, with empty hands."
        for n in range(1, count + 1)
    )
    panels = "\n\n".join(
        f"PANEL {n:02d} ({n - 1}–{n}s):\n"
        "SHOT: Inspect and reset\nCAMERA: Eye-level locked-off 50mm medium shot\n"
        "ACTION: The ceramicist lifts the vase, inspects its base, then returns it upright.\n"
        "MOTION: The vase rises, turns once, and settles on the workbench before the hands withdraw.\n"
        f'DIALOG: {"HOST — Keep this exact line." if n == count else ""}\n'
        "NOTES: Preserve the original vase and apron; the vase ends upright with both hands clear."
        for n in range(1, count + 1)
    )
    header = (
        "BOARD TITLE: Workshop inspection\nPROJECT: Workshop\nSEQUENCE:\nLOCATION: Workbench\nDATE:\nARTIST:\n"
        "REFERENCE INPUTS AND PRIORITY:\n"
        "[image reference 1] observed ceramicist; [image reference 2] supporting views. "
        "The original photograph governs clothing and the supporting sheet cannot override it.\n\n"
    )
    return header + panels, states


class StoryboardVisualContinuityTests(unittest.TestCase):
    def setUp(self):
        bytecode = patch.object(sys, "dont_write_bytecode", True)
        bytecode.start()
        self.addCleanup(bytecode.stop)

    def test_recipe_requests_supported_frame_section_without_redefining_metadata(self):
        from app import store_seed_prompt_recipes as recipes

        rows = seeded_recipes(recipes)
        recipe = rows[RECIPE_ID]
        template = recipe["system_prompt_template"]
        self.assertIn("include a VISUAL CONTINUITY: section", template)
        self.assertEqual(recipe["version"], "2.29")
        self.assertIn("never use PANEL headings inside this section", template)
        self.assertIn("these frame states take precedence", template)
        self.assertIn("do not replace them with endpoint-only summaries", template)
        self.assertIn("ACTION states what the subject or scene element does in the current beat", template)
        self.assertIn("reproduce each supplied note verbatim", template)
        self.assertEqual(rows["prompt-recipe-storyboard-continuation-v1"]["version"], "1.21")
        self.assertNotIn("DEPICTED FRAME STATES:", rows["prompt-recipe-storyboard-continuation-v1"]["system_prompt_template"])
        self.assertEqual(recipe["output_format"], "single_prompt")
        self.assertEqual(recipe["default_options_json"], {"temperature": 0.25, "max_output_tokens": 2400, "strict_output": True})

    def test_data_update_only_changes_known_builtin_text_version_and_timestamp(self):
        from app import store_seed_prompt_recipes as recipes

        seeded = seeded_recipes(recipes)[RECIPE_ID]
        old = copy.deepcopy(seeded)
        block = recipes.STORYBOARD_VISUAL_CONTINUITY_INSTRUCTION + "\n\n"
        old["system_prompt_template"] = old["system_prompt_template"].replace(block, "", 1)
        old.update(version="2.28", label="Keep label", default_options_json={"max_output_tokens": 3100})
        connection = Mock()
        connection.execute.return_value.fetchone.return_value = old
        with patch.object(recipes, "utcnow_iso", return_value="updated"):
            recipes.update_storyboard_visual_continuity_recipe(connection)
        self.assertEqual(connection.execute.call_count, 2)
        query, values = connection.execute.call_args.args
        self.assertEqual(query, "UPDATE prompt_recipes SET system_prompt_template = ?, version = ?, updated_at = ? WHERE recipe_id = ?")
        self.assertEqual(values, (seeded["system_prompt_template"], "2.29", "updated", RECIPE_ID))
        self.assertEqual(old["version"], "2.28")
        self.assertEqual(old["label"], "Keep label")
        self.assertEqual(old["default_options_json"], {"max_output_tokens": 3100})

    def test_data_update_preserves_custom_missing_unrecognized_and_newer_records(self):
        from app import store_seed_prompt_recipes as recipes

        for row in (None, {"source_kind": "custom", "version": "2.28"},
                    {"source_kind": "builtin", "version": "2.29"},
                    {"source_kind": "builtin", "version": "3"},
                    {"source_kind": "builtin", "version": "2.28", "system_prompt_template": "User-authored replacement"}):
            with self.subTest(row=row):
                connection = Mock()
                connection.execute.return_value.fetchone.return_value = row
                recipes.update_storyboard_visual_continuity_recipe(connection)
                self.assertEqual(connection.execute.call_count, 1)

    def test_frame_states_preserve_every_typed_field_for_four_six_nine_panels(self):
        from app.graph.prompt_shaping import shape_kie_graph_prompt
        from app.graph.storyboard_sheet_spec import storyboard_art_prompt, storyboard_sheet_spec_from_mapping, storyboard_sheet_spec_from_recipe_result

        for count in (4, 6, 9):
            with self.subTest(count=count):
                raw, states = multi_action_result(count)
                before = storyboard_sheet_spec_from_recipe_result({"raw_text": raw})
                heading = "PANEL 01"
                refined = raw.replace(heading, "VISUAL CONTINUITY:\n" + states + "\n\n" + heading, 1)
                after = storyboard_sheet_spec_from_recipe_result({"raw_text": refined})
                self.assertEqual(before.panels, after.panels)
                self.assertEqual(before.production_metadata, after.production_metadata)
                self.assertEqual(before.visual_context["reference"], after.visual_context["reference"])
                self.assertEqual(after.visual_context["visual_continuity"], states)
                self.assertEqual(storyboard_sheet_spec_from_mapping(after.to_dict()), after)
                prompt = storyboard_art_prompt(after)
                self.assertIn(states, prompt)
                for panel in before.panels:
                    for value in (panel.action, panel.motion, panel.notes, panel.dialog):
                        self.assertIn(value, prompt)
                self.assertEqual([p.time_range for p in after.panels], [f"{n - 1}–{n}s" for n in range(1, count + 1)])
                self.assertEqual(shape_kie_graph_prompt("gpt-image-2", prompt, max_chars=20000).prompt, prompt)
                with self.assertRaisesRegex(ValueError, "limit"):
                    shape_kie_graph_prompt("gpt-image-2", prompt, max_chars=len(prompt) - 1)


if __name__ == "__main__":
    with patch.object(sqlite3, "connect", side_effect=AssertionError("Database access denied")), patch.object(socket, "create_connection", side_effect=AssertionError("Network access denied")), patch.object(socket.socket, "connect", side_effect=AssertionError("Network access denied")):
        unittest.main()
