"""Kernel display completion regressions; direct unittest, no pytest fixtures."""
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class DisplayCompletionTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch('sqlite3.connect', side_effect=AssertionError('No database')))
        self.stack.enter_context(patch('socket.socket.connect', side_effect=AssertionError('No network')))
        from app.assistant import kernel, schemas
        self.kernel, self.schemas = kernel, schemas
        self.session = {'provider_kind': 'codex_local', 'provider_model_id': 'test', 'summary_json': {}}
        self.binding = {'run_id': 'old-run', 'artifact_id': 'original', 'version': 'exact-version'}
        self.stack.enter_context(patch.object(kernel, '_sync_kernel_prompt_thread', side_effect=lambda session, _: session))
        self.stack.enter_context(patch.object(kernel, '_kernel_session_context', return_value={}))
        self.stack.enter_context(patch.object(kernel, 'resolve_assistant_provider_runtime', return_value=SimpleNamespace(provider_kind='codex_local')))
        self.tools = self.stack.enter_context(patch.object(kernel, 'execute_kernel_tool', side_effect=self.execute))

    def execute(self, tool_name, **_kwargs):
        return SimpleNamespace(result=self.binding, trace=self.schemas.AssistantKernelToolTrace(
            tool_name=tool_name, arguments_hash='test', duration_ms=1, result_size_bytes=80,
            activity={'kind': 'result_display', 'label': 'Displayed your image', 'tone': 'success'},
        ))

    def step(self, *, intent='display_image', tool='show_run_result', reply='Here is the original image.'):
        return {'capability': 'general', 'artifact_intent': intent, 'reply': reply,
                'tool_call': {'name': tool, 'arguments': '{}'} if tool else None}

    def run_steps(self, steps, **kwargs):
        with patch.object(self.kernel, 'run_kernel_provider_step', side_effect=steps) as provider:
            result = self.kernel.run_assistant_kernel_turn(
                session=self.session, user_text='Display my image.', workflow=None,
                canvas_context={}, assistant_mode=None, **kwargs,
            )
        return result, provider.call_count

    def test_exact_display_finishes_without_a_closing_provider_call(self):
        result, count = self.run_steps([self.step()])
        self.assertEqual(count, 1)
        self.assertEqual(result.reply, 'Here is the original image.')
        self.assertEqual(result.artifacts[0].data, self.binding)
        self.assertEqual(result.next_action.kind, 'none')
        self.assertEqual(result.trace.step_count, 1)

    def test_display_without_prefilled_reply_uses_success_activity(self):
        result, count = self.run_steps([self.step(reply=None)])
        self.assertEqual(count, 1)
        self.assertEqual(result.reply, 'Displayed your image')

    def test_multiple_images_and_inspection_do_not_finish_after_first_card(self):
        result, count = self.run_steps([
            self.step(intent='none'), self.step(intent='none'),
            self.step(intent='none', tool='inspect_selected_result'),
            self.step(intent='none', tool=None, reply='Both images were inspected.'),
        ])
        self.assertEqual(count, 4)
        self.assertEqual(len(result.artifacts), 2)
        self.assertEqual(result.reply, 'Both images were inspected.')
        self.assertEqual(self.tools.call_args_list[-1].kwargs['tool_name'], 'inspect_selected_result')

    def test_failed_binding_does_not_finish_with_a_success_reply(self):
        failure = SimpleNamespace(result=None, trace=self.schemas.AssistantKernelToolTrace(
            tool_name='show_run_result', arguments_hash='stale', duration_ms=1, result_size_bytes=0,
            error={'code': 'result_changed', 'message': 'That exact result changed.', 'retryable': True},
        ))
        self.tools.side_effect = [failure, self.execute('show_run_result')]
        result, count = self.run_steps([self.step(), self.step(reply='Here is the verified image.')])
        self.assertEqual(count, 2)
        self.assertEqual(len(result.artifacts), 1)
        self.assertEqual(result.reply, 'Here is the verified image.')

    def test_active_production_plan_preserves_followup_work(self):
        self.session['summary_json']['production_plan'] = {}
        result, count = self.run_steps([self.step(), self.step(tool=None, reply='Plan review completed.')])
        self.assertEqual(count, 2)
        self.assertEqual(result.reply, 'Plan review completed.')

    def test_cancelled_provider_step_never_displays_a_result(self):
        event = Event()
        def cancelled_step(**_kwargs):
            event.set()
            return self.step()
        with self.assertRaises(self.kernel.AssistantRequestCancelled):
            self.run_steps(cancelled_step, cancel_event=event)
        self.tools.assert_not_called()


if __name__ == '__main__':
    unittest.main()
