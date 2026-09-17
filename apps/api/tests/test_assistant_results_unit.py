"""Public result-read/selection regressions; direct unittest, no pytest fixtures."""
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
with patch('sqlite3.connect', side_effect=AssertionError('No database')), patch('socket.socket.connect', side_effect=AssertionError('No network')):
    from app.assistant import results
    from fastapi import HTTPException


class ResultTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch('sqlite3.connect', side_effect=AssertionError('No database')))
        self.stack.enter_context(patch('socket.socket.connect', side_effect=AssertionError('No network')))
        self.session = {'assistant_session_id': 'session-a', 'owner_kind': 'graph_workflow', 'owner_id': 'graph-a', 'summary_json': {}}
        self.run = {'run_id': 'run-a', 'workflow_id': 'graph-a', 'status': 'completed', 'workflow_json': {'name': 'Portraits', 'nodes': [{'id': 'direction', 'type': 'prompt.text', 'metadata': {'ui': {'customTitle': 'Portrait direction'}}}]}}
        self.artifacts = [{'artifact_id': 'text-a', 'run_id': 'run-a', 'workflow_id': 'graph-a', 'node_id': 'direction', 'node_type': 'prompt.text', 'output_port': 'text', 'output_index': 0, 'kind': 'text', 'value_json': {'value': 'Portrait: warm window light'}}]
        for owner, name, effect in [
            (results.store_assistant, 'get_assistant_session', lambda _: self.session),
            (results.store, 'get_graph_run', lambda _: self.run),
            (results.store, 'list_graph_artifacts_for_run', lambda _: self.artifacts),
            (results.store, 'list_graph_run_nodes', lambda _: [{'node_id': 'direction', 'status': 'completed'}]),
        ]:
            self.stack.enter_context(patch.object(owner, name, side_effect=effect))

    def test_selected_media_keeps_exact_identity_and_rejects_missing_or_changed_files(self):
        self.artifacts = [{**self.artifacts[0], 'artifact_id': 'image-2', 'kind': 'asset', 'media_type': 'image', 'asset_id': 'asset-2', 'output_index': 1, 'value_json': {}}]
        self.stack.enter_context(patch.object(results.store, 'get_asset', return_value={'generation_kind': 'image', 'hero_original_path': 'media/second.png'}))
        self.stack.enter_context(patch('pathlib.Path.exists', return_value=True))
        stat = type('Stat', (), {'st_size': 123, 'st_mtime_ns': 10})()
        self.stack.enter_context(patch('pathlib.Path.stat', return_value=stat))
        self.stack.enter_context(patch.object(results.store_assistant, 'set_assistant_result_selection', side_effect=self.persist_selection))
        card = results.read_run_results('session-a', 'run-a')['items'][0]
        self.assertTrue(card['available'])
        selected = results.select_run_result('session-a', results.ResultSelection(run_id='run-a', artifact_id='image-2', version=card['version']))
        self.assertEqual(selected['selected_artifact_ids'], ['image-2'])
        self.assertEqual(results.selected_results('session-a')[0]['asset_id'], 'asset-2')
        stat.st_mtime_ns = 11
        with self.assertRaises(HTTPException):
            results.selected_results('session-a')
        with patch('pathlib.Path.exists', return_value=False):
            card = results.read_run_results('session-a', 'run-a')['items'][0]
            self.assertFalse(card['available'])
        self.run['status'] = 'failed'
        with patch.object(results.store, 'list_graph_run_nodes', return_value=[{'node_id': 'direction', 'status': 'failed'}]):
            self.assertFalse(results.read_run_results('session-a', 'run-a')['items'][0]['available'])

    def persist_selection(self, sid, artifact_id, binding):
        selections = self.session['summary_json'].setdefault('selected_results', {})
        if binding is None:
            selections.pop(artifact_id, None)
        else:
            selections[artifact_id] = binding
        return list(selections)

    def save_plan(self, record):
        self.plan = {**record, 'assistant_plan_id': 'new-plan'}
        return self.plan

    def test_new_stage_materializes_selected_text_and_excludes_prior_generators(self):
        from app import kie_adapter
        from app.assistant import kernel_tools
        from app.graph.schemas import GraphWorkflow, GraphWorkflowNode
        self.session['summary_json'] = {'selected_results': {'text-a': {'run_id': 'run-a', 'version': results.read_run_results('session-a', 'run-a')['items'][0]['version']}}}
        for owner, name, value in [
            (kernel_tools.store, 'get_prompt_recipe_drafting_config', None),
            (kernel_tools.store, 'cache_graph_node_definitions', None),
            (kernel_tools.store, 'list_prompt_recipes', []),
            (kernel_tools.store, 'list_projects', []),
            (kernel_tools.store, 'list_presets', []),
            (kernel_tools.store_assistant, 'list_assistant_plans', []),
            (kernel_tools.store_assistant, 'reject_validated_assistant_plans', None),
            (kie_adapter, 'list_models', []), (kie_adapter, 'model_diagnostics', {}),
        ]:
            self.stack.enter_context(patch.object(owner, name, return_value=value))
        self.stack.enter_context(patch.object(kernel_tools.store_assistant, 'create_or_update_assistant_plan', side_effect=lambda record: self.save_plan(record)))
        old = GraphWorkflow(workflow_id='graph-a', name='Original', nodes=[GraphWorkflowNode(id='old-generator', type='prompt.text', fields={'text': 'Do not repeat'})])
        execution = kernel_tools.execute_kernel_tool(
            tool_name='propose_graph_operations', capability='graph_builder', arguments={
                'summary': 'Independent environment stage with selected direction',
                'new_stage_name': 'Environment stage',
                'reused_results': [{'artifact_id': 'text-a', 'node_ref': 'direction'}],
                'operations': [
                    {'op': 'add_node', 'node_ref': 'preview', 'node_type': 'display.any', 'position': {'x': 500, 'y': 0}},
                    {'op': 'connect_nodes', 'source_ref': 'direction', 'source_port': 'text', 'target_ref': 'preview', 'target_port': 'value'},
                ],
            }, context=kernel_tools.KernelToolContext(workflow=old, canvas_context={}, session_id='session-a', session=self.session, capability='graph_builder'),
        )
        self.assertIsNone(execution.trace.error, execution.trace.error)
        plan = execution.result
        self.assertTrue(plan['action_metadata']['independent_stage'])
        self.assertIsNone(plan['workflow']['workflow_id'])
        self.assertEqual(len(plan['workflow']['nodes']), 2)
        self.assertNotIn('old-generator', [node['id'] for node in plan['workflow']['nodes']])
        self.assertEqual(plan['workflow']['nodes'][0]['fields']['text'], 'Portrait: warm window light')
        self.assertEqual(old.nodes[0].fields['text'], 'Do not repeat')
        from app.assistant.routes import apply_plan, get_session
        from app.assistant.schemas import AssistantPlanApplyRequest
        self.stack.enter_context(patch.object(results.store_assistant, 'get_assistant_plan', side_effect=lambda _: self.plan))
        self.stack.enter_context(patch.object(results.store_assistant, 'create_assistant_message', return_value={}))
        self.stack.enter_context(patch.object(results.store_assistant, 'create_or_update_assistant_session', return_value=self.session))
        with patch.object(results.store_assistant, 'list_assistant_plans', side_effect=lambda _: [self.plan]), patch.object(results.store_assistant, 'list_assistant_messages', return_value=[]), patch.object(results.store_assistant, 'list_assistant_attachments', return_value=[]):
            self.assertIsNotNone(get_session('session-a').latest_plan, 'A saved source conversation must expose its independent stage for review')
            self.session['owner_id'] = 'another-workflow'
            self.assertIsNone(get_session('session-a').latest_plan)
            self.session['owner_id'] = 'graph-a'
        applied = apply_plan('new-plan', AssistantPlanApplyRequest(workflow=old, proposal_id='new-plan', confirmation_token=plan['confirmation_token']))
        self.assertEqual([node.id for node in applied.workflow.nodes], [node['id'] for node in plan['workflow']['nodes']])
        self.assertEqual(applied.workflow.name, 'Environment stage')
        self.assertEqual(old.name, 'Original')
        binding = applied.workflow.nodes[0].metadata.get('source_result')
        self.assertIsNotNone(binding, 'Applied stages must retain exact result provenance')
        from app.assistant.provenance import workflow_fingerprint
        rebound = applied.workflow.model_copy(deep=True)
        rebound.nodes[0].metadata['source_result']['version'] = 'new-version'
        self.assertNotEqual(workflow_fingerprint(applied.workflow), workflow_fingerprint(rebound))
        from app.graph.validator import validate_workflow
        self.artifacts[0]['value_json']['value'] = 'Changed after application'
        validation = validate_workflow(applied.workflow)
        self.assertIn('source_result_changed', [error.code for error in validation.errors])


    def test_exact_completed_text_is_readable_without_executing_a_graph(self):
        response = results.read_run_results('session-a', 'run-a')
        self.assertEqual(response['items'][0]['text'], 'Portrait: warm window light')
        self.assertEqual(response['items'][0]['artifact_id'], 'text-a')
        self.assertEqual(response['items'][0]['node_title'], 'Portrait direction')
        self.assertTrue(response['items'][0]['available'])
        self.run['workflow_id'] = 'other-graph'
        with self.assertRaises(HTTPException) as failure:
            results.read_run_results('session-a', 'run-a')
        self.assertEqual(failure.exception.status_code, 409)


if __name__ == '__main__':
    unittest.main()
