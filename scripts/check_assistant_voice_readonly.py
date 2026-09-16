"""Compare runtime and evaluator word policy on existing replies without writes or providers."""
import argparse, json, sqlite3, subprocess
from pathlib import Path
from app.settings import settings
from app.assistant.voice import count_reply_words, lint_assistant_reply

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--db',type=Path,required=True)
args=parser.parse_args()
assert settings.db_path.resolve()==args.db.resolve() and args.db.is_file() and args.db.stat().st_size>0
c=sqlite3.connect(args.db.resolve().as_uri()+'?mode=ro',uri=True);c.execute('pragma query_only=ON')
rows=c.execute("""SELECT content_text, content_json FROM assistant_messages
 WHERE role='assistant' AND content_text != '' AND json_valid(content_json)
 ORDER BY created_at DESC LIMIT 30""").fetchall()
cases=[]
for reply,encoded in rows:
    content=json.loads(encoded)
    capability=content.get('kernel_turn',{}).get('capability') or content.get('capability') or 'general'
    cases.append({'scenario':{'mechanical':{}},'reply':reply,'contentJson':content,'plan':None,'jobsBefore':0,'jobsAfter':0,'capability':capability})
cases.append({'scenario':{'mechanical':{}},'reply':'# One\n- **two** _three_\n> four-five','contentJson':{},'plan':None,'jobsBefore':0,'jobsAfter':0,'capability':'general'})
for reply in ['one\u0085two', 'one\ufefftwo']:
    cases.append({**cases[-1], 'reply': reply})
script='''import {evaluateMechanicalTurn} from './scripts/lib/assistant_conversation_probe_contract.mjs';
let text=''; for await (const chunk of process.stdin) text+=chunk;
console.log(JSON.stringify(JSON.parse(text).map(input=>evaluateMechanicalTurn(input).reply_length)));'''
results=json.loads(subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(cases),capture_output=True,text=True,check=True).stdout)
for case,result in zip(cases,results):
    count=count_reply_words(case['reply'])
    limit=400 if case['capability']=='story_builder' else 150
    assert result['words']==count and result['max_words']==limit
    violations=[v for v in lint_assistant_reply(case['reply'],capability=case['capability']) if v.code=='reply_too_long']
    assert bool(violations)==(count>limit)==(not result['pass'])
    if violations: assert violations[0].word_count==count
assert [r['words'] for r in results[-3:]] == [5, 1, 2]
for capability,limit in [('general',150),('story_builder',400)]:
    assert not any(v.code=='reply_too_long' for v in lint_assistant_reply('word '*limit,capability=capability))
    assert any(v.code=='reply_too_long' for v in lint_assistant_reply('word '*(limit+1),capability=capability))
print('PASS runtime/evaluator agreement on',len(rows),'existing replies, literal Markdown example and exact 150/400 boundaries')
