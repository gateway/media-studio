"""Pure geometry regressions. Run directly; no pytest/database fixtures."""
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class WidthLayoutTests(unittest.TestCase):
    def setUp(self):
        from app.assistant import workflow_layout
        from app.graph.schemas import GraphNodeDefinition, GraphWorkflow
        self.layout = workflow_layout
        self.GraphWorkflow = GraphWorkflow
        definitions = {
            kind: GraphNodeDefinition(type=kind, title=kind, category="test", ui={"default_size": {"width": width, "height": height}}, ports={"inputs": [{"id": "image", "label": "Image", "type": "image", "array": True}], "outputs": [{"id": "image", "label": "Image", "type": "image"}]})
            for kind, width, height in [("media.load_image", 680, 620), ("prompt.recipe", 420, 1900), ("model.test", 420, 620), ("preview.image", 680, 620), ("utility.note", 420, 620)]
        }
        self.definitions = definitions
        mocked = patch.object(workflow_layout.registry, "get_definition", side_effect=lambda kind: definitions[kind])
        mocked.start()
        self.addCleanup(mocked.stop)

    def workflow(self, count=4):
        refs = [{"id": f"ref-{i}", "type": "media.load_image", "fields": {"reference_id": f"keep-{i}"}} for i in range(count)]
        nodes = refs + [{"id": "recipe", "type": "prompt.recipe", "fields": {"brief": "Keep exactly"}}, {"id": "image", "type": "model.test"}, {"id": "review", "type": "preview.image"}, {"id": "video", "type": "model.test", "metadata": {"execution": {"mode": "muted"}}}, {"id": "preview", "type": "preview.image"}]
        pairs = [(ref["id"], target) for ref in refs for target in ("image", "video")] + [("recipe", "image"), ("image", "review"), ("image", "video"), ("video", "preview")]
        edges = [{"id": f"edge-{i}", "source": source, "target": target, "source_port": "image", "target_port": "image"} for i, (source, target) in enumerate(pairs)]
        return self.GraphWorkflow.model_validate({"name": "Width proof", "nodes": nodes, "edges": edges, "metadata": {"groups": [{"id": "production", "title": "Production", "node_ids": [n["id"] for n in nodes], "bounds": {}}]}})

    def assert_geometry(self, workflow):
        from app.graph.layout import node_bounds, rects_have_gap
        nodes = {node.id: node for node in workflow.nodes}
        for index, node in enumerate(workflow.nodes):
            for other in workflow.nodes[index + 1:]:
                self.assertTrue(rects_have_gap(node_bounds(node), node_bounds(other), 96))
        for edge in workflow.edges:
            source = node_bounds(nodes[edge.source])
            self.assertLessEqual(source["x"] + source["width"] + 96, nodes[edge.target].position["x"])

    def test_height_budget_and_semantics_and_idempotence(self):
        workflow = self.workflow()
        before = workflow.model_dump()
        arranged = self.layout.arrange_workflow(workflow)
        self.assert_geometry(arranged)
        self.assertEqual(arranged.metadata["groups"][0]["bounds"]["height"], 1900 + 192)
        self.assertGreater(len({n.position["x"] for n in arranged.nodes if n.id.startswith("ref")}), 1)
        self.assertEqual(workflow.model_dump(), before)
        self.assertEqual(workflow.edges, arranged.edges)
        for a, b in zip(workflow.nodes, arranged.nodes):
            self.assertEqual(a.model_dump(exclude={"position"}), b.model_dump(exclude={"position"}))
        self.assertEqual(self.layout.arrange_workflow(arranged), arranged)

    def test_notes_beside_single_section_and_manual_sizes_respected(self):
        from app.graph.schemas import GraphWorkflowNode
        workflow = self.workflow()
        workflow.nodes[4].metadata["style"] = {"height": 2400, "width": 600}
        workflow.nodes.append(GraphWorkflowNode(id="note", type="utility.note", position={"x": 0, "y": -1000}))
        arranged = self.layout.arrange_workflow(workflow)
        self.assert_geometry(arranged)
        group = arranged.metadata["groups"][0]
        note = arranged.nodes[-1]
        self.assertGreater(note.position["x"], group["bounds"]["x"] + group["bounds"]["width"])
        self.assertEqual(group["bounds"]["height"], 2400 + 192)
        self.assertNotIn("note", group["node_ids"])
        self.assertEqual(self.layout.arrange_workflow(arranged), arranged)

    def test_resolves_each_node_size_once_during_stage_packing(self):
        workflow = self.workflow(500)
        nodes = {n.id: n for n in workflow.nodes}
        started = time.perf_counter()
        with patch.object(self.layout, "node_bounds", wraps=self.layout.node_bounds) as measure:
            self.layout.arrange_nodes(list(nodes), workflow, nodes)
            self.assertEqual(measure.call_count, len(nodes))
        print(f"Width-first layout: {len(nodes)} nodes / {len(workflow.edges)} edges in {(time.perf_counter() - started) * 1000:.2f}ms")

    def test_cycle_and_disconnected_nodes_are_deterministic(self):
        from app.graph.schemas import GraphWorkflowEdge
        workflow = self.workflow()
        workflow.edges.append(GraphWorkflowEdge(id="cycle", source="image", target="recipe", source_port="text", target_port="text"))
        result = self.layout.arrange_workflow(workflow)
        self.assertEqual(self.layout.arrange_workflow(result), result)

    def test_fresh_plan_uses_width_first_default_without_changing_existing_edits(self):
        from app.assistant import graph_plan
        from app.assistant.schemas import AssistantGraphPlan
        workflow = self.workflow()
        operations = [{"op": "add_node", "node_id": n.id, "node_ref": n.id, "node_type": n.type} for n in workflow.nodes]
        operations += [{"op": "connect_nodes", "source_ref": e.source, "target_ref": e.target, "source_port": e.source_port, "target_port": e.target_port} for e in workflow.edges]
        with patch.object(graph_plan, "materialize_workflow_defaults", side_effect=lambda w: w), patch.object(graph_plan.registry, "definitions_by_type", return_value=self.definitions):
            fresh = graph_plan.apply_graph_plan(self.GraphWorkflow(name="New"), AssistantGraphPlan(summary="Create", operations=operations))
            self.assert_geometry(fresh)
            from app.graph.layout import node_bounds
            bounds = [node_bounds(node) for node in fresh.nodes]
            self.assertLessEqual(max(b["y"] + b["height"] for b in bounds) - min(b["y"] for b in bounds), 1900)
            edited = graph_plan.apply_graph_plan(fresh, AssistantGraphPlan(summary="Title only", operations=[{"op": "set_node_title", "node_id": "image", "title": "New title"}]))
            self.assertEqual([n.position for n in fresh.nodes], [n.position for n in edited.nodes])


if __name__ == "__main__":
    with patch("sqlite3.connect", side_effect=AssertionError("Database forbidden")), patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")):
        unittest.main()
