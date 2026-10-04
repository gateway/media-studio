"""Direct unittest only: database/network denied before app imports; no pytest collection."""
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

class CommunicationTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch('sqlite3.connect', side_effect=AssertionError('No database')))
        self.stack.enter_context(patch('socket.socket.connect', side_effect=AssertionError('No network')))
        from app.assistant import cancellation, prompt_assets, kernel, schemas
        self.progress, self.assets, self.kernel, self.schemas = cancellation, prompt_assets, kernel, schemas

    def test_last_success_survives_thinking_and_compaction_but_not_another_turn(self):
        p = self.progress
        with p.track_session('communication') as event:
            self.assertIsNone(p.session_progress('communication')['last_milestone'])
            p.publish_session_progress('communication', stage='tool', label='Checked your graph')
            for stage in ('thinking', 'compacting', 'thinking'):
                p.publish_session_progress('communication', stage=stage, label='Continuing your request')
                state = self.schemas.AssistantProgress(**p.session_progress('communication'))
                self.assertEqual(state.last_milestone, 'Checked your graph')
                self.assertEqual(state.stage, stage)
            p.cancel_session('communication')
            self.assertTrue(event.is_set())
        self.assertFalse(p.session_progress('communication')['active'])
        with p.track_session('communication'):
            self.assertIsNone(p.session_progress('communication')['last_milestone'])

    def test_changed_prompt_rotates_once_and_retains_typed_constraints_and_context(self):
        k = self.kernel
        assembly = self.assets.assistant_thread_prompt_assembly(tuple(k.KERNEL_CAPABILITY_PROMPTS.values()), developer_addendum=k._kernel_instruction())
        session = {'assistant_session_id': 'communication', 'provider_kind': 'codex_local', 'provider_thread_id': 'old',
                   'state_snapshot_json': {'provider_generation': 2}, 'summary_json': {'kernel_story_state': {'shots': ['keep all shots']}, 'selected_results': {'exact': 'version'}}}
        original_summary = session['summary_json'].copy()
        with patch.object(k.enhancement_provider.codex_local_provider, 'close_codex_local_skill_session') as close, patch.object(k.store_assistant, 'create_or_update_assistant_session', side_effect=lambda updated: updated) as save:
            k._sync_kernel_prompt_thread(session, assembly)
            self.assertIsNone(session['provider_thread_id'])
            self.assertEqual(session['state_snapshot_json']['provider_generation'], 3)
            self.assertEqual(session['summary_json'], original_summary)
            k._sync_kernel_prompt_thread(session, assembly)
            self.assertEqual(close.call_count, 1)
            self.assertEqual(save.call_count, 1)
        with patch.object(k.store_assistant, 'list_assistant_plans', return_value=[]), patch.object(k.store_assistant, 'latest_saved_assistant_artifact', return_value=None), patch.object(k.store_assistant, 'recent_assistant_conversation', return_value=[{'content_text': 'Keep 4:3 and the original prompt.'}]), patch.object(k, 'assistant_image_model_defaults', return_value={}):
            context = k._kernel_session_context(session)
        self.assertEqual(context['active_story_state'], original_summary['kernel_story_state'])
        self.assertEqual(context['selected_results'], original_summary['selected_results'])
        self.assertIn('4:3', context['recent_conversation'][0]['content_text'])

    def run_turn(self, step, *, execution=None, user_text='Give me advice.', session_id=None, session_summary=None, workflow=None):
        k = self.kernel
        session = {'provider_kind': 'codex_local', 'summary_json': session_summary or {}, 'assistant_session_id': session_id}
        with patch.object(k.store_assistant, 'list_assistant_plans', return_value=[]), patch.object(k, '_sync_kernel_prompt_thread', side_effect=lambda session, _: session), patch.object(k, '_kernel_session_context', return_value={}), patch.object(k, 'resolve_assistant_provider_runtime', return_value=SimpleNamespace(provider_kind='codex_local')), patch.object(k, 'run_kernel_provider_step', side_effect=step if isinstance(step, list) else [step]) as provider, patch.object(k, 'execute_kernel_tool', return_value=execution) as tool:
            result = k.run_assistant_kernel_turn(session=session, user_text=user_text, workflow=workflow, canvas_context={}, assistant_mode=None)
        self.assertEqual(provider.call_count, len(step) if isinstance(step, list) else 1)
        self.assertEqual(tool.call_count, int(execution is not None))
        return result

    def execution(self, name, result, *, error=None):
        return SimpleNamespace(result=result, trace=self.schemas.AssistantKernelToolTrace(
            tool_name=name, arguments_hash='mock', duration_ms=1, result_size_bytes=100,
            activity={'kind': 'graph_check', 'label': 'Prepared graph changes for review', 'tone': 'error' if error else 'success'}, error=error))

    def test_advice_and_satisfaction_do_not_create_actions_or_tools(self):
        for request, reply, state in [('Should I keep the existing framing?', 'Keep the 4:3 framing to preserve the composition.', 'unknown'), ('That is good enough.', 'The prepared direction is ready when you need it.', 'satisfied')]:
            with self.subTest(request=request):
                result = self.run_turn({'capability': 'general', 'artifact_intent': 'none', 'reply': reply,
                    'guidance': {'suggestion_count': 0, 'satisfaction_state': state}}, user_text=request)
                self.assertEqual(result.next_action.kind, 'none')
                self.assertEqual(result.artifacts, [])
                self.assertEqual(result.trace.guidance.satisfaction_state, state)
                self.assertNotIn('?', result.reply)

    def test_narrow_edit_and_new_graph_keep_prepared_summary_and_exact_confirmation(self):
        for request, reply in [('Change only resolution to 2K.', 'Prepared the resolution change to 2K; the prompt and 4:3 framing are preserved.'), ('Prepare a new graph.', 'Prepared a prompt, image generator and preview for review.')]:
            with self.subTest(request=request):
                proposal = {'proposal_id': 'exact-proposal', 'confirmation_token': 'exact-token', 'pricing': {'pricing_summary': {'total': {'estimated_credits': 8}}}}
                result = self.run_turn({'capability': 'graph_builder', 'artifact_intent': 'none', 'reply': reply,
                    'tool_call': {'name': 'propose_graph_operations', 'arguments': '{}'}},
                    execution=self.execution('propose_graph_operations', proposal), user_text=request)
                self.assertRegex(result.reply.lower(), 'prepared.*(resolution|prompt)')
                self.assertNotRegex(result.reply.lower(), 'applied|started|saved|would you')
                self.assertEqual(result.next_action.kind, 'confirm_graph')
                self.assertTrue(result.next_action.requires_confirmation)
                self.assertEqual(result.next_action.proposal_id, 'exact-proposal')
                self.assertEqual(result.next_action.confirmation_token, 'exact-token')
                self.assertEqual(result.next_action.payload['confirmation_token'], 'exact-token')
                self.assertEqual(result.artifacts[0].data, proposal)

    def test_failed_preparation_never_publishes_a_success_milestone_or_action(self):
        with self.progress.track_session('failed-preparation'):
            self.progress.publish_session_progress('failed-preparation', stage='tool', label='Checked your graph')
            result = self.run_turn([
                {'capability': 'graph_builder', 'artifact_intent': 'none', 'reply': 'Prepared the edit.', 'tool_call': {'name': 'propose_graph_operations', 'arguments': '{}'}},
                {'capability': 'graph_builder', 'artifact_intent': 'none', 'reply': 'This setting is unavailable for the selected model.'},
            ], execution=self.execution('propose_graph_operations', {'proposal_id': 'unusable', 'confirmation_token': 'must-not-use'}, error={'code': 'unsupported_setting', 'message': 'Setting unavailable', 'retryable': False}), session_id='failed-preparation')
            self.assertEqual(result.next_action.kind, 'none')
            self.assertEqual(result.artifacts, [])
            self.assertRegex(result.reply.lower(), 'unavailable')
            self.assertNotRegex(result.reply.lower(), 'prepared|applied|started')
            self.assertEqual(self.progress.session_progress('failed-preparation')['last_milestone'], 'Checked your graph')

    def test_full_requested_shots_survive_a_compact_provider_summary(self):
        shots = [{'shot_number': i, 'title': f'Beat {i}', 'prompt': ('Preserve camera action identity dialogue atmosphere. ' * 30) + f'Unique ending {i}.'} for i in range(1, 7)]
        result = self.run_turn({'capability': 'story_builder', 'artifact_intent': 'update_story', 'reply': 'The shots are prepared.',
            'tool_call': {'name': 'update_story_state', 'arguments': '{}'}},
            execution=self.execution('update_story_state', {'update_kind': 'shot_list', 'state': {'shots': shots}}), user_text='Give me six detailed shots.')
        self.assertGreater(len(result.reply.split()), 400)
        for shot in shots:
            self.assertIn(f"Shot {shot['shot_number']}", result.reply)
            self.assertIn(shot['prompt'], result.reply)
        self.assertEqual(result.next_action.kind, 'none')

    def test_missing_graph_reply_names_the_typed_proposal_without_an_extra_provider_call(self):
        result = self.run_turn({'capability': 'graph_builder', 'artifact_intent': 'none', 'tool_call': {'name': 'propose_graph_operations', 'arguments': '{}'}},
            execution=self.execution('propose_graph_operations', {'proposal_id': 'exact', 'confirmation_token': 'token', 'summary': 'Rename only Shot 03.', 'operations': [{'op': 'set_node_title'}]}))
        self.assertIn('Rename only Shot 03.', result.reply)
        self.assertIn('review', result.reply)
        self.assertNotIn('applied', result.reply.lower())
        self.assertEqual(result.trace.step_count, 1)

    def test_missing_preset_and_recipe_replies_name_unsaved_typed_drafts(self):
        for name, kind, label in [('draft_preset', 'preset_draft', 'Media Preset'), ('draft_recipe', 'recipe_draft', 'Prompt Recipe')]:
            with self.subTest(kind=kind):
                # Use the registered terminal tool names; no persistence/provider/network.
                tool_name = 'propose_media_preset_draft' if kind == 'preset_draft' else 'propose_prompt_recipe_draft'
                result = self.run_turn({'capability': 'preset_builder' if kind == 'preset_draft' else 'recipe_builder', 'artifact_intent': name, 'tool_call': {'name': tool_name, 'arguments': '{}'}},
                    execution=self.execution(tool_name, {'draft': {'label': 'Dawn review'}, 'confirmation_token': 'exact'}))
                self.assertIn(label, result.reply)
                self.assertIn('Dawn review', result.reply)
                self.assertIn('not been saved', result.reply)
                self.assertEqual(result.trace.step_count, 1)

    def test_old_graph_proposal_is_not_reissued_for_a_new_advice_turn(self):
        from app.graph.schemas import GraphWorkflow
        workflow = GraphWorkflow(name='Review')
        with patch('app.assistant.provenance.materialize_workflow_defaults', side_effect=lambda value: value):
            fingerprint = self.kernel.workflow_fingerprint(workflow)
        plan = {'assistant_plan_id': 'old', 'assistant_session_id': 'current', 'status': 'validated',
                'plan_json': {'capability': 'plan_graph', 'summary': 'Old title edit', 'metadata': {
                    'base_workflow_fingerprint': fingerprint}}}
        with patch('app.assistant.provenance.materialize_workflow_defaults', side_effect=lambda value: value), patch.object(self.kernel.store_assistant, 'get_assistant_plan', return_value=plan):
            result = self.run_turn({'capability': 'general', 'artifact_intent': 'none', 'reply': 'Here is advice only.'},
                session_id='current', session_summary={'kernel_proposal_id': 'old'}, workflow=workflow)
        self.assertEqual(result.next_action.kind, 'none')
        self.assertEqual(result.reply, 'Here is advice only.')

    def test_explicit_review_request_reissues_only_the_exact_owned_proposal(self):
        from app.graph.schemas import GraphWorkflow
        workflow = GraphWorkflow(name='Review')
        with patch('app.assistant.provenance.materialize_workflow_defaults', side_effect=lambda value: value):
            fingerprint = self.kernel.workflow_fingerprint(workflow)
        plan = {'assistant_plan_id': 'owned', 'assistant_session_id': 'current', 'status': 'validated',
                'plan_json': {'capability': 'plan_graph', 'summary': 'Title edit', 'metadata': {'base_workflow_fingerprint': fingerprint}}}
        with patch('app.assistant.provenance.materialize_workflow_defaults', side_effect=lambda value: value), patch.object(self.kernel.store_assistant, 'get_assistant_plan', return_value=plan), patch.object(self.kernel.store_assistant, 'create_or_update_assistant_plan', side_effect=lambda value:value):
            for proposal_id in ('foreign', 'owned'):
                result = self.run_turn({'capability': 'graph_builder', 'artifact_intent': 'none', 'reply': 'Here is the requested review.', 'requested_action': {'kind': 'confirm_graph', 'proposal_id': proposal_id}},
                    session_id='current', session_summary={'kernel_proposal_id': 'owned'}, workflow=workflow, user_text='Show me the current proposal confirmation.')
                self.assertEqual(result.next_action.kind, 'confirm_graph' if proposal_id == 'owned' else 'none')
                if proposal_id == 'owned':
                    self.assertEqual(result.next_action.proposal_id, 'owned')
                    self.assertTrue(result.next_action.requires_confirmation)
                    self.assertTrue(result.next_action.confirmation_token)

    def test_assembled_prompts_support_all_three_journeys_without_obsolete_budget(self):
        assembly = self.assets.assistant_thread_prompt_assembly(tuple(self.kernel.KERNEL_CAPABILITY_PROMPTS.values()), developer_addendum=self.kernel._kernel_instruction())
        prompt = (assembly.base_instructions + assembly.developer_instructions).lower()
        self.assertIn('answer the immediate question first', prompt)
        self.assertIn('preserve unrelated prompts', prompt)
        self.assertIn('prepared for review, not applied or run', prompt)
        self.assertIn('when the user is satisfied', prompt)
        self.assertIn('full requested creative details', prompt)
        self.assertIn('confirmation button', prompt)
        self.assertNotIn('remaining_tool_calls', prompt)
        self.assertNotIn('end that reply with one literal question', prompt)
        self.assertNotIn('within 400 words', prompt)

if __name__ == '__main__':
    unittest.main()
