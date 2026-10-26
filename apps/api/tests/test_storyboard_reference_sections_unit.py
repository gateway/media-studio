"""Direct-run reference preservation regressions; DB and network stay denied."""
import socket
import sqlite3
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def recipe_result(subject="mechanic", product="courier bike", count=6, heading="REFERENCE INPUTS AND PRIORITY"):
    reference = (
        "Exactly four existing images are supplied in this order:\n"
        f"[image reference 1]: Original {subject} photograph; primary identity authority.\n"
        f"[image reference 2]: Supporting {subject} sheet; subordinate reconstruction.\n"
        f"[image reference 3]: Original {product} photograph; primary design authority.\n"
        f"[image reference 4]: Supporting {product} sheet; subordinate reconstruction.\n"
        "Preserve observed lettering: use the originals over reconstructed details."
    )
    text = (
        "BOARD TITLE: Reference preservation\nPROJECT: Neutral\nSEQUENCE:\nLOCATION: Studio\nDATE:\nARTIST:\n"
        f"{heading}:\n{reference}\n\n"
        "WARDROBE CUES:\nKeep the established work clothes.\n\n"
        + "\n".join(
            f"PANEL {n:02d} ({n - 1}–{n}s):\nSHOT: Design inspection\n"
            "CAMERA: Eye-level static 50mm lens\n"
            f"ACTION: The {subject} inspects the {product}.\n"
            "MOTION: The camera creeps closer.\n"
            f'DIALOG: {"HOST — You can see the detail." if n == count else ""}\n'
            "NOTES: Keep the established object upright."
            for n in range(1, count + 1)
        )
    )
    return {"recipe_key": "storyboard-v2-gpt-image-2", "raw_text": text}, " ".join(reference.split())


class StoryboardReferenceSectionsTests(unittest.TestCase):
    def setUp(self):
        bytecode = patch.object(sys, "dont_write_bytecode", True)
        bytecode.start()
        self.addCleanup(bytecode.stop)

    def test_reference_priority_survives_compile_mapping_and_preparation(self):
        from app.graph.prompt_shaping import shape_kie_graph_prompt
        from app.graph.storyboard_sheet_spec import (
            storyboard_art_prompt,
            storyboard_sheet_spec_from_mapping,
            storyboard_sheet_spec_from_recipe_result,
        )

        for subject, product in (("mechanic", "courier bike"), ("ceramist", "blue vase")):
            for count in (4, 6, 9):
                with self.subTest(subject=subject, count=count):
                    result, reference = recipe_result(subject, product, count)
                    spec = storyboard_sheet_spec_from_recipe_result(result)
                    self.assertEqual(spec.visual_context.get("reference"), reference)
                    restored = storyboard_sheet_spec_from_mapping(spec.to_dict())
                    self.assertEqual(restored, spec)
                    prompt = storyboard_art_prompt(restored)
                    self.assertIn(reference, prompt)
                    self.assertNotIn("image reference", str(spec.production_metadata).lower())
                    self.assertEqual([p.time_range for p in spec.panels], [f"{n - 1}–{n}s" for n in range(1, count + 1)])
                    for panel in spec.panels:
                        for value in (panel.action, panel.motion, panel.notes, panel.dialog):
                            self.assertIn(value, prompt)
                    for field in ("SEQUENCE", "DATE", "ARTIST"):
                        self.assertEqual(spec.production_metadata[field], "")
                    shaped = shape_kie_graph_prompt("gpt-image-2", prompt, max_chars=20000)
                    self.assertEqual(shaped.prompt, prompt)
                    with self.assertRaisesRegex(ValueError, "limit"):
                        shape_kie_graph_prompt("gpt-image-2", prompt, max_chars=len(prompt) - 1)

    def test_existing_aliases_and_alias_alone_cannot_drop_prose_colons(self):
        from app.graph.storyboard_sheet_spec import _section, storyboard_sheet_spec_from_recipe_result

        for heading in ("REFERENCE INPUTS AND PRIORITY", "REFERENCE LOCKS", "REFERENCE ROLE LOCK", "REFERENCE AUTHORITY"):
            for spelling in (heading, heading.lower(), heading.title()):
                with self.subTest(heading=spelling):
                    result, reference = recipe_result(heading=spelling)
                    # Direct extraction isolates the boundary defect even with the correct alias.
                    self.assertEqual(_section(result["raw_text"], spelling), reference)
                    self.assertEqual(storyboard_sheet_spec_from_recipe_result(result).visual_context.get("reference"), reference)

    def test_real_compiler_and_request_preparation_preserve_roles_and_image_order(self):
        from app.graph.executors.base import GraphExecutionContext
        from app.graph.executors.kie_model import KieModelExecutor
        from app.graph.executors.storyboard_ops import StoryboardCompileExecutor
        from app.graph.schemas import GraphOutputRef, GraphWorkflow

        result, reference = recipe_result()
        workflow = GraphWorkflow.model_validate({
            "name": "Reference preservation", "nodes": [
                {"id": "recipe", "type": "prompt.recipe"},
                {"id": "compile", "type": "storyboard.compile"},
                {"id": "image", "type": "model.kie.test", "fields": {"aspect_ratio": "16:9", "resolution": "2K"}},
                *[{"id": f"ref-{n}", "type": "media.load_image"} for n in range(1, 5)],
            ], "edges": [
                {"id": "recipe-compile", "source": "recipe", "source_port": "result", "target": "compile", "target_port": "result"},
                {"id": "compile-image", "source": "compile", "source_port": "prompt", "target": "image", "target_port": "prompt"},
                *[{"id": f"image-{n}", "source": f"ref-{n}", "source_port": "image", "target": "image", "target_port": "image_refs"} for n in range(1, 5)],
            ],
        })
        context = GraphExecutionContext("", workflow)
        nodes = {node.id: node for node in workflow.nodes}
        context.publish_outputs(nodes["recipe"], {"result": [GraphOutputRef(kind="value", value=result)]})
        for n in range(1, 5):
            context.publish_outputs(nodes[f"ref-{n}"], {"image": [GraphOutputRef(kind="reference_media", reference_id=f"ref-neutral-{n}")]})
        output = StoryboardCompileExecutor().execute(nodes["compile"], context)
        context.publish_outputs(nodes["compile"], output)
        definition = SimpleNamespace(
            source={"model_key": "gpt-image-2", "task_modes": ["image_edit"], "output_media_type": "image"},
            fields=[SimpleNamespace(id="aspect_ratio"), SimpleNamespace(id="resolution")],
        )
        with patch("app.graph.executors.kie_model.registry.get_definition", return_value=definition), patch("app.service_prompt_budget.model_prompt_max_chars", return_value=20000):
            request = KieModelExecutor().prepare_request(nodes["image"], context)
        self.assertIn(reference, request.prompt)
        self.assertEqual(request.prompt, output["prompt"][0].value)
        self.assertEqual([image.reference_id for image in request.images], [f"ref-neutral-{n}" for n in range(1, 5)])
        self.assertEqual(request.options, {"aspect_ratio": "4:3", "resolution": "2K"})
        self.assertEqual(request.task_mode, "image_edit")
        self.assertFalse(context.node_metrics["image"]["provider_submitted"])

    def test_reference_block_stops_before_real_sections_and_panel_headings(self):
        from app.graph.storyboard_sheet_spec import _section

        boundaries = (
            "WARDROBE CUES: Clothes remain unchanged.",
            "Wardrobe Cues: Clothes remain unchanged.",
            "STYLE DIRECTION: Clay animation.",
            "PRODUCTION METADATA: PROJECT: Neutral",
            "Handoff Advance: Move to the next scene.",
            "Dialogue Cues: HOST — Keep this line.",
            "LOCATION: Studio",
            "UNRELATED SECTION: Do not absorb this section.",
            "PANEL 01:\nSHOT: Inspect the object",
            "PANEL 01 (0–1s)\nSHOT: Inspect the object",
            "1. Panel 01 IMAGE AND METADATA (0–1s):\nSHOT: Inspect the object",
        )
        for boundary in boundaries:
            with self.subTest(boundary=boundary):
                text = "REFERENCE AUTHORITY:\nKeep these roles:\n[image reference 1]: Original subject.\n\n" + boundary
                self.assertEqual(_section(text, "REFERENCE AUTHORITY"), "Keep these roles: [image reference 1]: Original subject.")

    def test_panel_reference_prose_does_not_truncate_the_authority_block(self):
        from app.graph.storyboard_sheet_spec import _section

        body = (
            "Panel 03 uses [image reference 1] as packaging authority.\n"
            "[image reference 2]: Supporting reconstruction only.\n"
        )
        text = "REFERENCE AUTHORITY:\n" + body + "\nPANEL 01 (0–1s):\nSHOT: Inspect the object"
        self.assertEqual(_section(text, "REFERENCE AUTHORITY"), " ".join(body.split()))


if __name__ == "__main__":
    with patch.object(sqlite3, "connect", side_effect=AssertionError("Database forbidden")), patch.object(socket.socket, "connect", side_effect=AssertionError("Network forbidden")):
        unittest.main()
