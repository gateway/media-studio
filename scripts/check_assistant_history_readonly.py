"""Check bounded provider context against existing history; never create a database."""
import argparse
import copy
import json
import sqlite3
import statistics
import time
from contextlib import contextmanager
from pathlib import Path

from app import db
from app.settings import settings

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--db',type=Path,required=True)
parser.add_argument('--measure-baseline',action='store_true')
args=parser.parse_args()
assert settings.db_path.resolve()==args.db.resolve() and args.db.is_file() and args.db.stat().st_size>0
reads=[]
projection=None

class Cursor:
    def __init__(self,cursor,record): self.cursor,self.record=cursor,record
    def fetchall(self):
        rows=self.cursor.fetchall()
        if self.record is not None: self.record['rows']+=len(rows)
        return rows
    def fetchone(self):
        row=self.cursor.fetchone()
        if self.record is not None: self.record['rows']+=int(row is not None)
        return row

class Connection:
    def __init__(self,connection): self.connection=connection
    def execute(self,sql,parameters=()):
        assert sql.lstrip().upper().startswith(('SELECT','WITH','PRAGMA')), 'Regression attempted a write'
        record=None
        if 'assistant_messages' in sql:
            record={'rows':0}; reads.append(record)
            if projection is not None:
                fields=['assistant_message_id','assistant_session_id','role','content_text','content_json','created_at']
                columns=', '.join(f"json_extract(value,'$.{field}') AS {field}" for field in fields)
                sql=f'WITH assistant_messages AS (SELECT {columns} FROM json_each(?)) '+sql
                parameters=(json.dumps(projection),*parameters)
        return Cursor(self.connection.execute(sql,parameters),record)

@contextmanager
def readonly():
    connection=sqlite3.connect(args.db.resolve().as_uri()+'?mode=ro',uri=True)
    connection.row_factory=sqlite3.Row;connection.execute('pragma query_only=ON')
    try: yield Connection(connection)
    finally: connection.close()

db.get_connection=readonly
from app import store_assistant
from app.assistant import kernel

def forbid_provider(**kwargs): raise AssertionError('External provider is forbidden')
kernel.run_read_only_provider_turn=forbid_provider
current={}
store_assistant.create_or_update_assistant_session=lambda value: copy.deepcopy(value)
original_get_session=store_assistant.get_assistant_session
store_assistant.get_assistant_session=lambda sid: copy.deepcopy(current) if sid==current.get('assistant_session_id') else original_get_session(sid)

def observe(session,exclude):
    global current
    current=copy.deepcopy(session)
    current.update(summary_json={},state_snapshot_json={},provider_thread_id=None)
    assert kernel.resolve_assistant_provider_runtime(current).provider_kind=='codex_local'
    payloads=[]
    def provider(**kwargs):
        payloads.append(json.loads(kwargs['messages'][0]['content'].split('PAYLOAD_JSON\n',1)[1]))
        return {'capability':'general','artifact_intent':'none','reply':'I can discuss that without making changes.'}
    kernel.run_kernel_provider_step=provider
    reads.clear()
    kernel.run_assistant_kernel_turn(session=current,user_text='Discuss the current context without changes.',workflow=None,canvas_context={},assistant_mode='graph',client_user_message_id=exclude)
    assert args.measure_baseline or len(reads)<=2 and sum(r['rows'] for r in reads)<=7, ('History materialized beyond the six-message plus saved-artifact contract',reads)
    return payloads[0]['session_context']

with sqlite3.connect(args.db.resolve().as_uri()+'?mode=ro',uri=True) as connection:
    connection.row_factory=sqlite3.Row;connection.execute('pragma query_only=ON')
    sessions=[row[0] for row in connection.execute('select assistant_session_id from assistant_messages group by assistant_session_id order by count(*) desc limit 3')]
    saved=connection.execute("SELECT content_json FROM assistant_messages WHERE role='system_summary' AND CASE WHEN json_valid(content_json) THEN json_type(content_json,'$.saved_artifact') END='object' LIMIT 1").fetchone()
    assert saved
    saved_artifact=json.loads(saved[0])['saved_artifact']
    for sid in sessions:
        rows=[dict(r) for r in connection.execute('select * from assistant_messages where assistant_session_id=?',(sid,))]
        ordered=sorted(rows,key=lambda r:(r['created_at'],r['assistant_message_id']))
        exclude=next(r['assistant_message_id'] for r in reversed(ordered) if r['role']=='user')
        eligible=[r for r in ordered if r['role'] in {'user','assistant'} and r['assistant_message_id']!=exclude][-6:]
        expected=[{'role':r['role'],'text':str(r['content_text'] or '')[:800]} for r in eligible]
        actual=observe(original_get_session(sid),exclude)
        assert actual['recent_conversation']==expected
        samples=[]
        for _ in range(15):
            started=time.perf_counter(); observe(original_get_session(sid),exclude);samples.append((time.perf_counter()-started)*1000)
        print('CONTEXT',sid,'messages',len(rows),'median_ms',round(statistics.median(samples),3),'fetched_rows',sum(r['rows'] for r in reads))
    source=rows[0]

if args.measure_baseline:
    raise SystemExit(0)

# CTE rows shadow the table for these reads only: no SQL DB or rows are created.
session=original_get_session(sessions[-1])
projection=[]
for i in range(9):
    projection.append({**source,'assistant_session_id':session['assistant_session_id'],'assistant_message_id':f'projection-{i:02}','role':'user' if i%2==0 else 'assistant','content_text':f'Message {i}','created_at':'2026-09-13T00:00:00+00:00','content_json':'{}'})
projection[0].update(role='system_summary',content_json=json.dumps({'saved_artifact':saved_artifact}))
projection[1]['content_text']='x'*900
projection[7].update(role='system_summary',content_json='{broken')
projection[8].update(role='system_summary',content_json=json.dumps({'saved_artifact':[]}))
actual=observe(session,'projection-06')
assert [x['text'] for x in actual['recent_conversation']]==['x'*800,'Message 2','Message 3','Message 4','Message 5']
assert actual['latest_saved_artifact']==saved_artifact
for i in range(9, 13):
    projection.append({**projection[2], 'assistant_message_id': f'projection-{i:02}', 'content_text': f'Message {i}'})
actual=observe(session,'projection-06')
assert len(actual['recent_conversation']) == 6
assert actual['latest_saved_artifact'] == saved_artifact
assert 'x'*800 not in [x['text'] for x in actual['recent_conversation']]
actual=observe(session,'projection-00')
assert actual['latest_saved_artifact'] is None
assert len(actual['recent_conversation'])==6
print('PASS stable ties, exclusion before limit, roles, malformed JSON, truncation and old saved artifact')
