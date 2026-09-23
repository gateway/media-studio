"""Standalone regressions; imports and cases deny database/network access."""
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class ContinuityEditsTests(unittest.TestCase):
    def setUp(self):
        from app.graph.schemas import GraphWorkflow, GraphNodeDefinition
        from app.assistant import graph_plan
        self.plan = graph_plan
        self.workflow = GraphWorkflow.model_validate({"workflow_id": "owned", "name": "Original", "nodes": [
            {"id": "ref", "type": "media.load_image", "fields": {"reference_id": "original"}},
            {"id": "model", "type": "model.kie.old", "position": {"x": 900,"y": 30}, "fields": {"prompt":"Keep every word.","size":"2K"}, "metadata":{"execution":{"mode":"frozen"},"ui":{"customTitle":"Product"}}},
            {"id": "preview", "type": "preview.image"}],
            "edges": [{"id":"in", "source":"ref", "source_port":"image", "target":"model", "target_port":"images", "metadata":{"order":1}}, {"id":"out", "source":"model", "source_port":"image", "target":"preview", "target_port":"image"}],
            "metadata":{"groups":[{"id":"g", "node_ids":["model"],"bounds":{"x":800,"y":0,"width":500,"height":500}}]}})
        def definition(kind, inputs, outputs, fields=()):
            return GraphNodeDefinition(type=kind, title=kind, category="test", ports={"inputs":[{"id":p,"label":p,"type":t,"array":p=="refs","max":4 if p=="refs" else 1} for p,t in inputs],"outputs":[{"id":p,"label":p,"type":t} for p,t in outputs]},fields=[{"id":key,"label":key,"type":"text"} for key in fields])
        self.definitions = {
            "media.load_image": definition("media.load_image",[],[("image","image")], ["reference_id"]),
            "model.kie.old": definition("model.kie.old",[("images","image")],[("image","image")],["prompt","size"]),
            "model.kie.new": definition("model.kie.new",[("refs","image")],[("image","image")],["prompt","resolution"]),
            "preview.image": definition("preview.image",[("image","image")],[]),
        }
        self.stack=ExitStack();self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(graph_plan,"materialize_workflow_defaults",side_effect=lambda w:w))
        self.stack.enter_context(patch.object(graph_plan.registry,"definitions_by_type",return_value=self.definitions))
        self.stack.enter_context(patch.object(graph_plan.registry,"get_definition",side_effect=lambda key:self.definitions[key]))

    def apply(self, operations):
        from app.assistant.schemas import AssistantGraphPlan
        return self.plan.apply_graph_plan(self.workflow,AssistantGraphPlan(summary="Reviewed edit",operations=operations))

    def replacement(self, **overrides):
        return {"op":"replace_model","node_id":"model","node_type":"model.kie.new","fields":{"resolution":"2K"},"remove_field_ids":["size"],"input_port_map":{"images":"refs"},"output_port_map":{"image":"image"},**overrides}

    def test_replace_preserves_unaffected_content_identity_and_order(self):
        before=self.workflow.model_dump()
        result=self.apply([self.replacement(),{"op":"rename_workflow","title":"Revised"}])
        self.assertEqual(self.workflow.model_dump(),before)
        self.assertEqual(result.name,"Revised")
        self.assertEqual(result.nodes[1].id,"model")
        self.assertEqual(result.nodes[1].fields,{"prompt":"Keep every word.","resolution":"2K"})
        self.assertEqual(result.nodes[1].metadata,self.workflow.nodes[1].metadata)
        self.assertEqual(result.nodes[1].position,self.workflow.nodes[1].position)
        self.assertEqual(result.metadata,self.workflow.metadata)
        self.assertEqual([edge.id for edge in result.edges],["in","out"])
        self.assertEqual(result.edges[0].target_port,"refs")
        self.assertEqual(result.edges[0].metadata,{"order":1})

    def test_incompatible_or_missing_mapping_is_atomic(self):
        before=self.workflow.model_dump()
        for operation in [self.replacement(input_port_map={}),self.replacement(input_port_map={"images":"missing"}),self.replacement(remove_field_ids=[])]:
            with self.assertRaises(ValueError): self.apply([{"op":"rename_workflow","title":"Should not apply"},operation])
            self.assertEqual(self.workflow.model_dump(),before)

    def test_explicit_edge_removal_and_update_preserve_others(self):
        result=self.apply([self.replacement(input_port_map={"images":None})])
        self.assertEqual([edge.id for edge in result.edges],["out"])
        result=self.apply([{"op":"remove_edge","edge_id":"out"},{"op":"update_edge","edge_id":"in","target_ref":"preview","target_port":"image"}])
        self.assertEqual(result.edges[0].id,"in")
        self.assertEqual(result.edges[0].target,"preview")

    def test_actual_modes_and_narrow_hold_exception(self):
        from app.assistant.schemas import AssistantGraphPlan
        for mode in ["muted","frozen","enabled","bypassed"]:
            ops=[{"op":"set_execution_mode","node_id":"model","execution_mode":mode}]
            result=self.apply(ops)
            self.assertEqual(result.nodes[1].metadata['execution']['mode'],mode)
            self.assertEqual(self.plan.is_hold_only_plan(AssistantGraphPlan(summary="Mode",operations=ops)),mode in {"muted","frozen"})
        self.assertFalse(self.plan.is_hold_only_plan(AssistantGraphPlan(summary="Mixed",operations=[{"op":"set_execution_mode","node_id":"model","execution_mode":"muted"},self.replacement()])))

    def test_edit_fingerprint_detects_name_layout_and_reference_order(self):
        from app.assistant.graph_edits import graph_edit_fingerprint
        with patch('app.graph.normalization.materialize_workflow_defaults',side_effect=lambda w:w):
            original=graph_edit_fingerprint(self.workflow)
            variants=[]
            other=self.workflow.model_copy(deep=True);other.name="Another";variants.append(other)
            other=self.workflow.model_copy(deep=True);other.nodes[1].position['x']=42;variants.append(other)
            other=self.workflow.model_copy(deep=True);other.edges.reverse();variants.append(other)
            for other in variants:self.assertNotEqual(original,graph_edit_fingerprint(other))

    def test_unknown_usage_stays_unknown(self):
        from app.assistant.turn_trace import build_assistant_turn_trace
        empty=build_assistant_turn_trace({})
        self.assertIsNone(empty['provider_total_tokens'])
        known=build_assistant_turn_trace({'kernel_turn':{'trace':{'provider_steps':[{'usage':{'prompt_tokens':30,'completion_tokens':5,'prompt_tokens_details':{'cached_tokens':10}}}]}}})
        self.assertEqual(known['provider_input_tokens'],30)
        self.assertEqual(known['provider_cached_input_tokens'],10)
        self.assertIsNone(known['provider_uncached_input_tokens'])

    def test_unbounded_work_budget_retains_compaction_and_finite_consumers(self):
        from app.codex_turn_budget import CodexTurnBudget
        with patch('app.codex_turn_budget.time.monotonic',return_value=0):
            work=CodexTurnBudget(None);finite=CodexTurnBudget(180)
        with patch('app.codex_turn_budget.time.monotonic',return_value=1000):
            self.assertEqual(work.remaining_seconds,float('inf'))
            self.assertLess(finite.remaining_seconds,0)
            work.turn_id='current'
            work.observe({'method':'item/started','params':{'threadId':'owned','turnId':'other','item':{'type':'contextCompaction','id':'bad'}}},'owned')
            self.assertFalse(work.compacting)
            work.observe({'method':'item/started','params':{'threadId':'owned','turnId':'current','item':{'type':'contextCompaction','id':'c'}}},'owned')
            self.assertTrue(work.compacting)
            work.observe({'method':'item/completed','params':{'threadId':'owned','turnId':'current','item':{'type':'contextCompaction','id':'c'}}},'owned')
            self.assertFalse(work.compacting)


    def test_replacement_rejects_unknown_model_and_incompatible_field_values(self):
        from app.graph.schemas import GraphNodeField
        self.definitions["model.kie.new"].fields.append(GraphNodeField(id="count",label="Count",type="integer",min=1,max=3))
        self.definitions["model.kie.new"].fields[1].options=["1K","2K"]
        before=self.workflow.model_dump()
        for operation in [self.replacement(node_type="model.kie.missing"),self.replacement(fields={"resolution":"8K"}),self.replacement(fields={"count":99}),self.replacement(fields={"count":1.5})]:
            with self.assertRaises(ValueError):self.apply([operation])
            self.assertEqual(before,self.workflow.model_dump())

    def test_replacement_review_discloses_removed_prompt(self):
        from app.assistant.graph_diff import graph_plan_diff_summary
        from app.assistant.schemas import AssistantGraphPlan
        operation=self.replacement(remove_field_ids=["size","prompt"])
        result=self.apply([operation])
        with patch("app.assistant.graph_diff.materialize_workflow_defaults",side_effect=lambda w:w):
            diff=graph_plan_diff_summary(self.workflow,result,AssistantGraphPlan(summary="Remove",operations=[operation]))
        self.assertTrue(any("prompt" in text and "Keep every word." in text and "None" in text for text in diff["edit_changes"]))

    def test_reference_cache_invalidates_and_never_borrows_foreign_selection(self):
        from app.assistant import reference_analysis as owner
        session={"assistant_session_id":"owned","summary_json":{}}
        context=SimpleNamespace(session_id="owned",session=session,attachments=[{"assistant_attachment_id":"a","reference_id":"ref","kind":"image","label":"Host"}],timeout_seconds=None,cancel_event=None,provider_steps=[])
        runtime=SimpleNamespace(provider_kind="codex_local",provider_model_id="model-a")
        def remember(value):session.update(value);return session
        with ExitStack() as stack:
            stack.enter_context(patch.object(owner.store_assistant,"get_assistant_session",return_value=session))
            stack.enter_context(patch.object(owner.store_assistant,"create_or_update_assistant_session",side_effect=remember))
            stack.enter_context(patch.object(owner,"_reference_paths",return_value=["/unused-reference"]))
            content=stack.enter_context(patch.object(owner.Path,"read_bytes",return_value=b"first image"))
            stack.enter_context(patch.object(owner,"resolve_assistant_provider_runtime",return_value=runtime))
            stack.enter_context(patch.object(owner.enhancement_provider,"build_openai_compatible_multimodal_content",return_value="mock image content"))
            provider=stack.enter_context(patch.object(owner.enhancement_provider,"run_codex_local_chat",return_value={"generated_text":"{}","usage":{"prompt_tokens":10}}))
            args=owner.AnalyzeReferenceImagesArguments(reference_ids=["ref"],goal="recipe_context")
            self.assertEqual(owner.analyze_reference_images(args,context)["cache_status"],"miss")
            self.assertEqual(owner.analyze_reference_images(args,context)["cache_status"],"hit")
            self.assertEqual(provider.call_count,1)
            content.return_value=b"new image"
            self.assertEqual(owner.analyze_reference_images(args,context)["cache_status"],"miss")
            runtime.provider_model_id="model-b"
            self.assertEqual(owner.analyze_reference_images(args,context)["cache_status"],"miss")
            with patch.object(owner,"REFERENCE_ANALYSIS_SYSTEM_INSTRUCTION","Changed instruction"):
                self.assertEqual(owner.analyze_reference_images(args,context)["cache_status"],"miss")
            args.focus="packaging"
            self.assertEqual(owner.analyze_reference_images(args,context)["cache_status"],"miss")
            calls=provider.call_count
            context.attachments=[]
            with self.assertRaises(owner.ReferenceAnalysisError):owner.analyze_reference_images(args,context)
            self.assertEqual(provider.call_count,calls)
            self.assertEqual(len(context.provider_steps),calls)
            self.assertTrue(provider.call_args.kwargs["unbounded_turn"])

    def test_nested_usage_is_included_without_counting_cache_hits(self):
        from app.assistant.turn_trace import build_assistant_turn_trace
        result=build_assistant_turn_trace({"kernel_turn":{"trace":{"provider_steps":[{"purpose":"planning","usage":{"prompt_tokens":30}},{"purpose":"visual analysis","usage":{"prompt_tokens":12}}]}}})
        self.assertEqual(result["provider_input_tokens"],42)
        self.assertIsNone(result["provider_output_tokens"])

    def test_recipe_save_intent_offers_real_card_after_validation(self):
        from app.assistant import recipe_kernel as owner
        session={"assistant_session_id":"owned","summary_json":{}}
        context=SimpleNamespace(session_id="owned",session=session,artifact_intent="save_recipe")
        arguments=owner.ProposePromptRecipeDraftArguments(draft={"key":"new","label":"New","category":"image","system_prompt_template":"Preserve the brief"},request_save_confirmation=False)
        with patch.object(owner.store_assistant,"get_assistant_session",return_value=session),patch.object(owner.store_assistant,"create_or_update_assistant_session"),patch.object(owner,"_editable_recipe_id",return_value=None),patch.object(owner,"_validated_draft",return_value={"key":"new"}) as validate:
            result=owner.propose_prompt_recipe_draft(arguments,context)
            self.assertTrue(result["save_ready"])
            self.assertTrue(result["confirmation_token"])
            validate.assert_called_once()
            context.artifact_intent="draft_recipe"
            self.assertFalse(owner.propose_prompt_recipe_draft(arguments,context)["save_ready"])
            validate.side_effect=owner.RecipeKernelError(code="invalid_prompt_recipe_draft",message="Missing required field")
            with self.assertRaises(owner.RecipeKernelError):owner.propose_prompt_recipe_draft(arguments,context)

    def test_nested_stop_retains_unknown_failed_step(self):
        from threading import Event
        from app.assistant import reference_analysis as owner
        from app.assistant.cancellation import AssistantRequestCancelled
        event=Event();event.set()
        context=SimpleNamespace(cancel_event=event,provider_steps=[])
        with patch.object(owner.enhancement_provider,"run_codex_local_chat",side_effect=owner.enhancement_provider.EnhancementProviderError("Interrupted")):
            with self.assertRaises(AssistantRequestCancelled):owner._run_visual_analysis(context,model_id="mock")
        self.assertEqual(len(context.provider_steps),1)
        self.assertIsNone(context.provider_steps[0].latency_ms)

    def test_muted_dependency_only_blocks_executing_consumers(self):
        from app.graph import validator
        graph=self.workflow.model_copy(deep=True)
        graph.nodes=graph.nodes[1:]
        graph.edges=graph.edges[1:]
        graph.nodes[0].metadata["execution"]["mode"]="muted"
        self.definitions["preview.image"].ports["inputs"][0].required=True
        with patch.object(validator,"materialize_workflow_defaults",side_effect=lambda w:w),patch.object(validator,"cached_output_for_node",return_value=None):
            for mode in ["muted","frozen"]:
                graph.nodes[1].metadata={"execution":{"mode":mode}}
                self.assertTrue(validator.validate_workflow(graph).valid)
            graph.nodes[1].metadata={"execution":{"mode":"enabled"}}
            self.assertTrue(any(error.code=="muted_required_dependency" for error in validator.validate_workflow(graph).errors))


if __name__ == '__main__':
    with patch('sqlite3.connect',side_effect=AssertionError('Database forbidden')),patch('socket.socket.connect',side_effect=AssertionError('Network forbidden')):
        unittest.main()
