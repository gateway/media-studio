"""Direct unittest; database/network denied before application imports."""
import sys, unittest
from pathlib import Path
from contextlib import ExitStack
from unittest.mock import patch
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

class FailureTests(unittest.TestCase):
 def setUp(self):
  self.stack = ExitStack(); self.addCleanup(self.stack.close)
  self.stack.enter_context(patch("sqlite3.connect", side_effect=AssertionError("No database")))
  self.stack.enter_context(patch("socket.socket.connect", side_effect=AssertionError("No network")))
  from app.assistant import kernel_route, schemas
  self.route, self.schemas = kernel_route, schemas

 def test_provider_failure_preserves_one_request_and_safe_durable_outcome(self):
  r = self.route; messages = []
  session = {"assistant_session_id": "failed", "summary_json": {"kernel_story_state": {"shots": ["Keep the full shot"]}}}
  def write(payload):
   saved = {"assistant_message_id": "user-1", **payload}
   messages[:] = [saved]; return saved
  error = r.AssistantProviderChatError("PRIVATE transport payload api_key=secret")
  error.assistant_turn_trace = {"tool_calls": [{"tool_name": "update_story_state", "error": None}], "termination": "provider_error"}
  with patch.object(r.store_assistant, "list_assistant_messages", return_value=messages), patch.object(r.store_assistant, "create_assistant_message", side_effect=write), patch.object(r.store_assistant, "get_assistant_session", return_value=session), patch.object(r, "sync_assistant_session_provider", side_effect=lambda value, **_: value), patch.object(r, "run_assistant_kernel_turn", side_effect=error):
   with self.assertRaises(r.HTTPException) as caught:
    r.create_kernel_message(session=session, payload=self.schemas.AssistantMessageCreateRequest(content_text="Keep this request."), attachments=[])
  self.assertEqual(caught.exception.status_code, 502)
  self.assertEqual(caught.exception.detail["code"], "assistant_provider_failed")
  self.assertNotIn("PRIVATE", str(caught.exception.detail))
  self.assertEqual(len(messages), 1); self.assertEqual(messages[0]["role"], "user")
  self.assertEqual(messages[0]["content_text"], "Keep this request.")
  self.assertEqual(messages[0]["content_json"]["turn_outcome"]["state"], "failed")
  self.assertEqual(messages[0]["content_json"]["assistant_turn_trace"], error.assistant_turn_trace)
  self.assertEqual(session["summary_json"]["kernel_story_state"]["shots"], ["Keep the full shot"])

 def test_failure_before_message_persistence_does_not_invent_a_request(self):
  r=self.route
  with patch.object(r.store_assistant,"list_assistant_messages",return_value=[]),patch.object(r.store_assistant,"create_assistant_message") as write,patch.object(r,"sync_assistant_session_provider",side_effect=r.AssistantProviderChatError("PRIVATE")):
   with self.assertRaises(r.HTTPException) as caught:r.create_kernel_message(session={"assistant_session_id":"before"},payload=self.schemas.AssistantMessageCreateRequest(content_text="Original request"),attachments=[])
  self.assertEqual(caught.exception.detail["code"],"assistant_unavailable");self.assertEqual(write.call_count,0)

 def test_interruption_keeps_completed_tool_trace_on_the_original_request(self):
  r=self.route;messages=[];session={"assistant_session_id":"cancelled","summary_json":{"kernel_story_state":{"premise":"Saved dawn scene"}}}
  def write(payload):
   saved={"assistant_message_id":payload.get("assistant_message_id","user" if payload["role"]=="user" else "summary"),**payload}
   messages[:]=[m for m in messages if m["assistant_message_id"]!=saved["assistant_message_id"]]+[saved];return saved
  error=r.AssistantRequestCancelled("cancelled")
  error.assistant_turn_trace={"tool_calls":[{"tool_name":"update_story_state","activity":{"label":"Updated the story","tone":"success"},"error":None}],"provider_lifecycle":[]}
  with patch.object(r.store_assistant,"list_assistant_messages",return_value=messages),patch.object(r.store_assistant,"create_assistant_message",side_effect=write),patch.object(r.store_assistant,"get_assistant_session",return_value=session),patch.object(r.store_assistant,"create_or_update_assistant_session",side_effect=lambda value:value),patch.object(r,"sync_assistant_session_provider",side_effect=lambda value,**_:value),patch.object(r,"run_assistant_kernel_turn",side_effect=error):
   with self.assertRaises(r.HTTPException):r.create_kernel_message(session=session,payload=self.schemas.AssistantMessageCreateRequest(content_text="Keep my story."),attachments=[])
  user=next(m for m in messages if m["role"]=="user")
  self.assertEqual(user["content_json"]["assistant_turn_trace"]["tool_calls"][0]["activity"]["label"],"Updated the story")
  self.assertEqual(user["content_json"]["turn_outcome"]["state"],"interrupted")
  self.assertEqual(len([m for m in messages if m["role"]=="user"]),1)
  self.assertEqual(session["summary_json"]["kernel_story_state"]["premise"],"Saved dawn scene")

 def test_interruption_summary_does_not_mask_the_stalled_conversation(self):
  r=self.route;session={"assistant_session_id":"resume","summary_json":{}}
  history=[{"role":"user","content_text":"Original"},{"role":"system_summary","content_json":{"activity_kind":"assistant_turn_interrupted"}}]
  with patch.object(r.store_assistant,"list_assistant_messages",return_value=history),patch.object(r,"sync_assistant_session_provider",side_effect=r.AssistantProviderChatError("stop before provider")) as sync:
   with self.assertRaises(r.HTTPException):r.create_kernel_message(session=session,payload=self.schemas.AssistantMessageCreateRequest(content_text="New explicit attempt"),attachments=[])
  self.assertTrue(sync.call_args.kwargs["force_new_thread"])

 def test_valid_successful_history_keeps_provider_resume(self):
  r=self.route;session={"assistant_session_id":"resume","summary_json":{}}
  with patch.object(r.store_assistant,"list_assistant_messages",return_value=[{"role":"user"},{"role":"assistant"}]),patch.object(r,"sync_assistant_session_provider",side_effect=r.AssistantProviderChatError("stop before provider")) as sync:
   with self.assertRaises(r.HTTPException):r.create_kernel_message(session=session,payload=self.schemas.AssistantMessageCreateRequest(content_text="Next turn"),attachments=[])
  self.assertFalse(sync.call_args.kwargs["force_new_thread"])

if __name__ == "__main__": unittest.main()
