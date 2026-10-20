"""Cache validation contracts, runnable without pytest's database fixtures."""
from __future__ import annotations

import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class WorkflowCacheValidationTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch("sqlite3.connect", side_effect=AssertionError("Database forbidden")))
        self.stack.enter_context(patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")))
        from app.graph import validator
        from app.graph.schemas import GraphNodeDefinition, GraphWorkflow

        self.validator = validator
        self.workflow_type = GraphWorkflow
        self.definition = GraphNodeDefinition(
            type="test.node", title="Test", category="test",
            ports={"inputs": [{"id": "in", "label": "Input", "type": "text", "required": True}],
                   "outputs": [{"id": "out", "label": "Output", "type": "text"}]},
            execution={"bypass_mode": {"input": "in", "output": "out"}},
        )
        self.stack.enter_context(patch.object(validator, "materialize_workflow_defaults", side_effect=lambda workflow: workflow))
        self.stack.enter_context(patch.object(validator.registry, "definitions_by_type", return_value={"test.node": self.definition}))
        self.cached = {"run_id": "run", "status": "completed", "output_snapshot_json": {"out": [{"reference_id": "ref"}]}}
        self.lookup = self.stack.enter_context(patch.object(validator.store, "latest_completed_graph_run_node_output", return_value=self.cached))
        self.artifacts = self.stack.enter_context(patch.object(validator.store, "list_graph_artifacts_for_node_run", return_value=[{"artifact_id": "artifact"}]))
        self.media = self.stack.enter_context(patch.object(validator.store, "get_reference_media", return_value={"reference_id": "ref"}))

    def workflow(self, mode="frozen", target_mode="enabled", **execution):
        return self.workflow_type.model_validate({
            "workflow_id": "workflow", "name": "Cache validation",
            "nodes": [
                {"id": "source", "type": "test.node", "metadata": {"execution": {
                    "mode": mode, "cached_artifact_ids": {"out": ["artifact"]}, **execution}}},
                {"id": "target", "type": "test.node", "metadata": {"execution": {"mode": target_mode}}},
            ],
            "edges": [{"id": "edge", "source": "source", "source_port": "out", "target": "target", "target_port": "in"}],
        })

    def codes(self, workflow):
        result = self.validator.validate_workflow(workflow)
        return [error.code for error in result.errors], [warning.code for warning in result.warnings]

    def test_usable_cache_satisfies_required_input_in_both_modes(self):
        for mode in ("frozen", "muted"):
            with self.subTest(mode=mode):
                self.assertEqual(self.codes(self.workflow(mode)), ([], []))

    def test_artifact_failure_precedes_media_check_and_preserves_mode_semantics(self):
        self.artifacts.return_value = []
        self.media.return_value = None
        self.assertEqual(self.codes(self.workflow()), (["frozen_artifact_missing"], []))
        self.assertEqual(self.codes(self.workflow("muted")), (["muted_required_dependency", "missing_required_input"], []))
        self.media.assert_not_called()

    def test_missing_media_is_an_error_only_for_frozen_cache(self):
        self.media.return_value = None
        self.assertEqual(self.codes(self.workflow()), (["frozen_media_missing"], []))
        self.assertEqual(self.codes(self.workflow("muted")), (["muted_required_dependency", "missing_required_input"], []))

    def test_missing_cache_preserves_optional_warnings_and_required_errors(self):
        self.lookup.return_value = None
        for mode, required_code, optional_code in (
            ("frozen", "frozen_dependency_missing", "frozen_optional_dependency_missing"),
            ("muted", "muted_required_dependency", "muted_optional_dependency"),
        ):
            with self.subTest(mode=mode):
                self.definition.ports["inputs"][0].required = True
                self.assertEqual(self.codes(self.workflow(mode)), ([required_code, "missing_required_input"], []))
                self.definition.ports["inputs"][0].required = False
                self.assertEqual(self.codes(self.workflow(mode)), ([], [optional_code]))
        self.artifacts.assert_not_called()
        self.media.assert_not_called()

    def test_no_workflow_id_does_not_query_cache(self):
        workflow = self.workflow()
        workflow.workflow_id = None
        self.assertEqual(self.codes(workflow), (["frozen_dependency_missing", "missing_required_input"], []))
        self.lookup.assert_not_called()

    def test_stale_explicit_run_binding_cannot_satisfy_input(self):
        with patch.object(self.validator.store, "get_graph_run", return_value={"workflow_id": "different"}):
            self.assertEqual(self.codes(self.workflow(cached_run_id="stale")), (["frozen_dependency_missing", "missing_required_input"], []))
        self.lookup.assert_not_called()

    def test_invalid_result_binding_is_reported_before_cache_error(self):
        workflow = self.workflow()
        workflow.nodes[0].metadata["source_result"] = {"schema_version": 0}
        self.artifacts.return_value = []
        result = self.validator.validate_workflow(workflow)
        self.assertEqual([error.code for error in result.errors], ["source_result_changed", "frozen_artifact_missing"])
        self.assertEqual(result.errors[1].model_dump(exclude_none=True), {
            "code": "frozen_artifact_missing", "message": "Frozen node references cached artifacts that no longer exist.", "node_id": "source",
        })

    def test_duplicate_and_unknown_nodes_skip_cache_checks(self):
        workflow = self.workflow()
        workflow.nodes.append(workflow.nodes[0].model_copy(deep=True))
        workflow.nodes.append(workflow.nodes[0].model_copy(update={"id": "unknown", "type": "unknown"}))
        errors, _ = self.codes(workflow)
        self.assertEqual(errors, ["duplicate_node_id", "missing_node_type", "cycle_detected"])
        self.lookup.assert_called_once_with("workflow", "source")

    def test_missing_edge_port_keeps_cache_error_first(self):
        workflow = self.workflow()
        workflow.edges[0].source_port = "missing"
        self.artifacts.return_value = []
        self.assertEqual(self.codes(workflow), (["frozen_artifact_missing", "missing_source_port", "missing_required_input"], []))

    def test_bypass_requires_available_cache_while_muted_target_does_not(self):
        self.lookup.return_value = None
        self.assertEqual(self.codes(self.workflow(target_mode="bypassed")), (["frozen_dependency_missing", "missing_bypass_input"], []))
        self.assertEqual(self.codes(self.workflow(target_mode="muted")), ([], []))


if __name__ == "__main__":
    unittest.main()
