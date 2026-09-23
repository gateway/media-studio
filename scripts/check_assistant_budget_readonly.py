"""Check productive planning and no-progress recovery using current read-only records."""
import argparse, copy, sqlite3
from contextlib import contextmanager
from pathlib import Path
from app import db
from app.settings import settings
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--db',type=Path,required=True)
parser.add_argument('--source-session',required=True)
args=parser.parse_args()
assert args.db.resolve()==settings.db_path.resolve() and args.db.is_file() and args.db.stat().st_size>0
@contextmanager
def readonly():
    c=sqlite3.connect(args.db.resolve().as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;c.execute('pragma query_only=ON')
    try:yield c
    finally:c.close()
db.get_connection=readonly
from app import store_assistant
from app.assistant import kernel
session=store_assistant.get_assistant_session(args.source_session)
assert session and kernel.resolve_assistant_provider_runtime(session).provider_kind=='codex_local'
session=copy.deepcopy(session);session.update(summary_json={},state_snapshot_json={},provider_thread_id=None)
store_assistant.create_or_update_assistant_session=lambda value:copy.deepcopy(value)
store_assistant.get_assistant_session=lambda _:copy.deepcopy(session)
def forbidden(**kwargs):raise AssertionError('External provider execution forbidden')
kernel.run_read_only_provider_turn=forbidden
observed=[]
def provider(**kwargs):
    assert kwargs['timeout_seconds'] is None
    assert not any('remaining_tool_calls' in m.get('content', '') for m in kwargs['messages'])
    observed.append(kwargs)
    if len(observed) <= 8:
        return {'capability':'preset_builder','artifact_intent':'none','tool_call':{'name':'search_presets','arguments':{'query':f'portrait variant {len(observed)}','limit':2}},'reply':''}
    return {'capability':'preset_builder','artifact_intent':'none','reply':'The requested searches are complete.'}
kernel.run_kernel_provider_step=provider
result=kernel.run_assistant_kernel_turn(session=session,user_text='Search my saved presets without changing anything.',workflow=None,canvas_context={},assistant_mode='preset')
assert len(observed)==9
assert result.trace.step_count==8 and result.trace.termination=='completed'
assert len(result.trace.tool_calls)==8 and all(not t.error for t in result.trace.tool_calls)
assert result.next_action.kind=='none'
print('PASS eight distinct searches finish without a tool-count or wall-clock pause')

# Repeated unchanged work still stops instead of looping indefinitely.
def repeat_unchanged(**kwargs):
    return {'capability':'preset_builder','artifact_intent':'none','tool_call':{'name':'search_presets','arguments':{'query':'portrait caricature','limit':2}},'reply':''}
kernel.run_kernel_provider_step=repeat_unchanged
result=kernel.run_assistant_kernel_turn(session=session,user_text='Search only.',workflow=None,canvas_context={},assistant_mode='preset')
assert result.trace.step_count==3 and len(result.trace.tool_calls)==3
assert result.trace.termination=='repeated_no_progress'
assert result.next_action.kind=='none'
print('PASS repeated unchanged work stops without mutation or provider execution')
