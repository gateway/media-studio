"""Check remaining-budget evidence at the provider boundary using current read-only records."""
import argparse, copy, json, sqlite3
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
    budget=next((json.loads(m['content'])['remaining_tool_calls'] for m in kwargs['messages'] if m['role']=='system' and 'remaining_tool_calls' in m['content']),None)
    assert budget is not None, 'Provider lacks remaining tool allowance and cannot reliably finish a bounded batch.'
    observed.append(budget)
    if budget:
        return {'capability':'preset_builder','artifact_intent':'none','tool_call':{'name':'search_presets','arguments':{'query':'portrait caricature','limit':2}},'reply':''}
    return {'capability':'preset_builder','artifact_intent':'none','reply':'The completed searches are ready; more requested searches remain.'}
kernel.run_kernel_provider_step=provider
result=kernel.run_assistant_kernel_turn(session=session,user_text='Search my saved presets without changing anything.',workflow=None,canvas_context={},assistant_mode='preset',max_tool_steps=2)
assert observed==[2,1,0],observed
assert result.trace.step_count==2 and result.trace.termination=='completed'
assert len(result.trace.tool_calls)==2 and all(not t.error for t in result.trace.tool_calls)
assert result.next_action.kind=='none'
print('PASS configured remaining allowance 2→1→0 reaches provider; final reply needs no extra tool or mutation')

# The allowance is information, never permission to exceed the configured guard.
observed.clear()
def ignore_budget(**kwargs):
    return {'capability':'preset_builder','artifact_intent':'none','tool_call':{'name':'search_presets','arguments':{'query':'portrait caricature','limit':2}},'reply':''}
kernel.run_kernel_provider_step=ignore_budget
result=kernel.run_assistant_kernel_turn(session=session,user_text='Search only.',workflow=None,canvas_context={},assistant_mode='preset',max_tool_steps=2)
assert result.trace.step_count==2 and len(result.trace.tool_calls)==2
assert result.trace.termination=='step_budget_exhausted'
result=kernel.run_assistant_kernel_turn(session=session,user_text='Search only.',workflow=None,canvas_context={},assistant_mode='preset',max_tool_steps=0)
assert result.trace.step_count==0 and not result.trace.tool_calls
assert result.trace.termination=='step_budget_exhausted'
print('PASS ignored allowance cannot exceed configured limits, including zero')
