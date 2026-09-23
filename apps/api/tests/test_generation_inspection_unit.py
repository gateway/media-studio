"""No pytest fixture imports: DB, network and submission are denied throughout."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

class InspectionTests(unittest.TestCase):
    def setUp(self):
        from app.assistant.generation_inspection import InspectGenerationArguments
        from app.graph.schemas import GraphWorkflow
        self.Args = InspectGenerationArguments
        self.workflow = GraphWorkflow.model_validate({"workflow_id":"test-owned", "name":"Pure", "nodes":[
            {"id":"prompt", "type":"prompt.text", "fields":{"text":"Keep the entire prompt. " * 230}},
            {"id":"image", "type":"model.kie.test", "fields":{"resolution":"2K"}}],
            "edges":[{"id":"e", "source":"prompt", "source_port":"text", "target":"image", "target_port":"prompt"}]})
        self.context = SimpleNamespace(workflow=self.workflow, session_id="owned")
        self.definition = SimpleNamespace(source={"model_key":"gpt-image-2", "task_modes":["text_to_image"], "output_media_type":"image"}, fields=[SimpleNamespace(id="prompt"),SimpleNamespace(id="resolution")])

    def test_shared_preparation_is_exact_and_never_submits(self):
        from app.assistant.generation_inspection import _prepare_current
        from app.graph.executors.kie_model import KieModelExecutor
        from app.service_errors import ServiceError
        from app.graph.executors.base import GraphExecutionContext
        from app.graph.executors.prompt_ops import PromptTextExecutor
        from app import service
        captured=[]
        def validate(request):
            captured.append(request)
            return {"final_prompt":request.prompt,"preflight":{"can_submit":True},"pricing_summary":{"total":{"estimated_credits":10}}}
        with patch("app.graph.normalization.materialize_workflow_defaults", side_effect=lambda w:w), patch("app.assistant.provenance.workflow_fingerprint", return_value="v1"), patch("app.graph.executors.kie_model.registry.get_definition", return_value=self.definition), patch("app.service_prompt_budget.model_prompt_max_chars", return_value=20000), patch.object(service,"build_validation_bundle", side_effect=validate), patch.object(service,"submit_jobs", side_effect=AssertionError("Submit forbidden")):
            result = _prepare_current(self.Args(node_id="image"),self.context)
            execution=GraphExecutionContext("",self.workflow)
            execution.publish_outputs(self.workflow.nodes[0],PromptTextExecutor().execute(self.workflow.nodes[0],execution))
            request=KieModelExecutor().prepare_request(self.workflow.nodes[1],execution)
            self.assertEqual(captured[0].model_dump(),request.model_dump())
            self.assertEqual(result["prompt"]["text"],request.prompt)
            self.assertFalse(result["provider_submitted"])
            self.assertEqual(result["account_readiness"],"unknown")
            with self.assertRaisesRegex(ValueError,"changed"):
                _prepare_current(self.Args(node_id="image",expected_workflow_fingerprint="v0"),self.context)

    def test_hard_rejection_retains_connected_authored_text(self):
        from app.graph.executors.kie_model import KieModelExecutor
        from app.service_errors import ServiceError
        from app.graph.executors.base import GraphExecutionContext
        from app.graph.executors.prompt_ops import PromptTextExecutor
        execution=GraphExecutionContext("",self.workflow)
        execution.publish_outputs(self.workflow.nodes[0],PromptTextExecutor().execute(self.workflow.nodes[0],execution))
        with patch("app.graph.executors.kie_model.registry.get_definition",return_value=self.definition),patch("app.service_prompt_budget.model_prompt_max_chars",return_value=100):
            with self.assertRaisesRegex(ServiceError,"too long"): KieModelExecutor().prepare_request(self.workflow.nodes[1],execution)
        self.assertEqual(execution.node_input_snapshots["image"]["authored_prompt"],self.workflow.nodes[0].fields["text"].strip())
        self.assertNotIn("prepared_prompt",execution.node_input_snapshots["image"])
        self.assertFalse(execution.node_metrics["image"]["provider_submitted"])

    def test_fingerprint_changes_with_model_options_prompt_and_edges(self):
        from app.assistant.provenance import workflow_fingerprint
        with patch("app.assistant.provenance.materialize_workflow_defaults",side_effect=lambda w:w):
            original=workflow_fingerprint(self.workflow)
            variants=[]
            for field,value in (("resolution","4K"),("prompt","Changed prompt")):
                changed=self.workflow.model_copy(deep=True);changed.nodes[1].fields[field]=value;variants.append(changed)
            changed=self.workflow.model_copy(deep=True);changed.nodes[1].type="model.kie.other";variants.append(changed)
            changed=self.workflow.model_copy(deep=True);changed.edges[0].source="different_reference";variants.append(changed)
            for changed in variants: self.assertNotEqual(original,workflow_fingerprint(changed))

    def test_dynamic_recipe_is_pending_and_disabled_is_not_funded(self):
        from app.assistant.generation_inspection import _prepare_current
        self.workflow.nodes[0].type="prompt.recipe"
        with patch("app.graph.normalization.materialize_workflow_defaults",side_effect=lambda w:w),patch("app.assistant.provenance.workflow_fingerprint",return_value="v1"),patch("app.service.build_validation_bundle",side_effect=AssertionError("Not prepared")):
            result=_prepare_current(self.Args(node_id="image"),self.context)
            self.assertEqual(result["pending_node_ids"],["prompt"])
            self.workflow.nodes[1].metadata={"execution":{"mode":"frozen"}}
            result=_prepare_current(self.Args(node_id="image"),self.context)
            self.assertEqual(result["status"],"disabled")
            self.assertEqual(result["account_readiness"],"unknown")

    def test_run_ownership_and_rejected_chunks(self):
        from app.assistant.generation_inspection import _run_evidence
        from fastapi import HTTPException
        from app import store,store_assistant
        session={"owner_kind":"graph_workflow","owner_id":"test-owned"}
        run={"run_id":"r","workflow_id":"test-owned"}
        node={"node_id":"recipe", "status":"failed", "input_snapshot_json":{"storyboard_contract_attempts":[{"stage":"repair","text":"bad output", "error":"Panel 06 ACTION empty"}]}}
        with patch.object(store_assistant,"get_assistant_session",return_value=session),patch.object(store,"get_graph_run",return_value=run),patch.object(store,"list_graph_run_nodes",return_value=[node]):
            result=_run_evidence(self.Args(node_id="recipe",run_id="r",evidence="rejected",limit=3),self.context)
            self.assertEqual(result["prompt"],{"text":"bad","total_chars":10,"next_offset":3})
            self.assertIsNone(result["provider_submitted"])
            node["status"]="running"
            self.assertIsNone(_run_evidence(self.Args(node_id="recipe",run_id="r"),self.context)["provider_submitted"])
            node["metrics_json"]={"provider_submitted":False}
            self.assertFalse(_run_evidence(self.Args(node_id="recipe",run_id="r"),self.context)["provider_submitted"])
            run["workflow_id"]="foreign"
            with self.assertRaises(HTTPException): _run_evidence(self.Args(node_id="recipe",run_id="r"),self.context)

if __name__ == "__main__":
    with patch("sqlite3.connect", side_effect=AssertionError("Database forbidden")),patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")):
        unittest.main()
