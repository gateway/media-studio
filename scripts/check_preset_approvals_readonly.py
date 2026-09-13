"""Real catalog/session projections; in-memory persistence and provider boundary only."""
from __future__ import annotations
import argparse
import copy
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from app import db
from app.settings import settings
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--db', type=Path, required=True)
parser.add_argument('--source-session', required=True)
parser.add_argument('--reference-session', required=True)
args = parser.parse_args()
expected = args.db.resolve()
assert settings.db_path.resolve() == expected and expected.is_file() and expected.stat().st_size > 0
@contextmanager
def readonly():
    connection = sqlite3.connect(expected.as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute('pragma query_only=ON')
    try: yield connection
    finally: connection.close()
db.get_connection = readonly
from app import store_assistant
from app.assistant import kernel
session = store_assistant.get_assistant_session(args.source_session)
assert session and session['summary_json'].get('kernel_preset_draft')
assert kernel.resolve_assistant_provider_runtime(session).provider_kind == 'codex_local', 'This projection requires the mocked Codex kernel boundary.'
def forbid_external_provider(**kwargs):
    raise AssertionError('External provider execution is forbidden in this read-only regression.')
kernel.run_read_only_provider_turn = forbid_external_provider
draft = copy.deepcopy(session['summary_json']['kernel_preset_draft'])
# Use the actual reviewed draft as the projection; never save it to the database.
print('projection',session['assistant_session_id'],draft['label'],draft['model_key'])
assert {f['key'] for f in draft['input_schema_json']} == {'occupation', 'setting'}, 'Select the recorded two-field caricature review source.'
assert draft['input_slots_json'][0]['key'] == 'portrait'
reference = store_assistant.get_assistant_session(args.reference_session)['summary_json']['reference_analysis_cache']
session['summary_json'] = {'reference_analysis_cache':reference}
draft['rules_json']['field_evidence'] = {'occupation':'Occupation','setting':'Setting'}
session['provider_thread_id'] = None
session['state_snapshot_json'] = {}
state = copy.deepcopy(session)
messages = {}
def save(value):
    global state
    state = copy.deepcopy(value)
    return copy.deepcopy(state)
store_assistant.create_or_update_assistant_session = save
store_assistant.get_assistant_session = lambda _: copy.deepcopy(state)
store_assistant.get_assistant_message = lambda mid: copy.deepcopy(messages.get(mid))
store_assistant.list_assistant_messages = lambda _: list(copy.deepcopy(messages).values())
store_assistant.list_assistant_plans = lambda _: []
# Actual provider boundary is replaced; kernel, tools, validation and model catalog stay real.
def turn(text, mid, provider_steps):
    messages[mid] = {'assistant_session_id':state['assistant_session_id'],'assistant_message_id':mid,'role':'user','content_text':text,'content_json':{}}
    steps = iter(provider_steps)
    kernel.run_kernel_provider_step = lambda **_: next(steps)
    return kernel.run_assistant_kernel_turn(session=copy.deepcopy(state),user_text=text,workflow=None,canvas_context={},assistant_mode='preset',client_user_message_id=mid)
slot = draft['input_slots_json'][0]
role = draft['rules_json']['runtime_image_roles'][slot['key']]['role']
text = f'I explicitly request a {slot["label"]} image with role {role}. Keep Occupation and Setting as text fields. Please ask me which model before making the draft.'
span = f'I explicitly request a {slot["label"]} image with role {role}.'
change = {'kind':'slot','key':slot['key'],'label':slot['label'],'role':role,'source_span':span,'action':'approve'}
turn(text,'projection-intake',[{'capability':'preset_builder','artifact_intent':'none','guidance':{'preset_approvals':[change, *[{'kind':'field','key':field['key'],'label':field['label'],'role':'','source_span':'Keep Occupation and Setting as text fields.','action':'approve'} for field in draft['input_schema_json']]]},'reply':'Which image model do you want?'}])
draft['rules_json']['runtime_image_roles'][slot['key']]['user_evidence'] = span
step = {'capability':'preset_builder','artifact_intent':'draft_preset','tool_call':{'name':'propose_media_preset_draft','arguments':{'draft':draft}},'reply':'Draft preserves the portrait, Occupation and Setting.'}
# Repeated terminal replies let the baseline report a genuine missing-artifact result.
end = {'capability':'preset_builder','artifact_intent':'draft_preset','reply':'I need the portrait requirement again.'}
result = turn('Use Nano Banana 2.','projection-model',[step,end,end])
errors = [x.error.code for x in result.trace.tool_calls if x.error]
assert any(a.kind == 'preset_draft' for a in result.artifacts), ('lost prior explicit slot approval',errors,result.reply)
print('PASS model clarification preserves earlier explicit slot approval', errors)
assert result.artifacts[0].data['draft']['input_schema_json'] == draft['input_schema_json']
print('PASS previous explicit fields survive with actual reference analysis')
original_state = copy.deepcopy(state)
t2i = copy.deepcopy(draft)
t2i.update(requires_image=False, input_slots_json=[], applies_to_task_modes=['text_to_image'], applies_to_input_patterns=['prompt_only'])
t2i['rules_json'].update(preset_lane='text_to_image', runtime_image_roles={})
t2i['prompt_template'] = t2i['prompt_template'].replace('[[portrait]]','a person described in text')
convert = copy.deepcopy(step)
convert['artifact_intent']='revise_preset'
convert['guidance']={'preset_approvals':[{'kind':'lane','key':'preset_lane','label':'text_to_image','role':'','source_span':'Make it text-to-image instead.','action':'approve'}]}
convert['tool_call']['arguments']['draft']=t2i
result = turn('Make it text-to-image instead.','projection-convert',[convert])
assert any(a.kind == 'preset_draft' for a in result.artifacts)
assert result.artifacts[0].data['draft']['input_schema_json'] == draft['input_schema_json']
assert not result.artifacts[0].data['draft']['input_slots_json']
print('PASS lane conversion removes slots and preserves explicit fields')
result = turn('Use Nano Banana 2.','projection-revive',[step,end,end])
assert not any(a.kind == 'preset_draft' for a in result.artifacts)
print('PASS removed slot cannot silently revive')
state = copy.deepcopy(original_state)
withdraw = {'kind':'field','key':'setting','label':'Setting','role':'','source_span':'Remove Setting.','action':'withdraw'}
turn('Remove Setting. We can discuss the replacement later.','projection-withdraw',[{'capability':'preset_builder','artifact_intent':'none','guidance':{'preset_approvals':[withdraw]},'reply':'Setting is withdrawn.'}])
result = turn('Keep the model.','projection-stale',[step,end,end])
assert not any(a.kind == 'preset_draft' for a in result.artifacts)
print('PASS withdrawn field rejected even on later continuation')
state = copy.deepcopy(original_state)
invented = copy.deepcopy(step)
invented['tool_call']['arguments']['draft']['rules_json']['runtime_image_roles']['portrait']['user_evidence']='Use Nano Banana 2.'
result = turn('Use Nano Banana 2.','projection-invented',[invented,end,end])
assert not any(a.kind == 'preset_draft' for a in result.artifacts)
assert any(x.error and x.error.code=='invalid_media_preset_slots' for x in result.trace.tool_calls)
print('PASS model-selection sentence cannot prove image role')
state = copy.deepcopy(original_state)
changed = copy.deepcopy(step)
changed['tool_call']['arguments']['draft']['input_schema_json'][0]['label']='Product'
result = turn('Keep the model.','projection-change',[changed,end,end])
assert not any(a.kind == 'preset_draft' for a in result.artifacts)
print('PASS retained approval cannot cover a changed field')
state = copy.deepcopy(original_state)
for target in ['slot:portrait','field:occupation','field:setting']:
    state['summary_json']['kernel_preset_approvals'].pop(target,None)
result = turn('Use Nano Banana 2.','projection-legacy',[step,end,end])
assert not any(a.kind == 'preset_draft' for a in result.artifacts)
print('PASS legacy draft without sources does not grant approval')
print('All checks used current database reads with in-memory writes and provider output.')
state = copy.deepcopy(original_state)
omitted = copy.deepcopy(step)
removed = omitted['tool_call']['arguments']['draft']['input_schema_json'].pop()
omitted['tool_call']['arguments']['draft']['prompt_template'] = omitted['tool_call']['arguments']['draft']['prompt_template'].replace('{{'+removed['key']+'}}', 'a landscape')
result = turn('Use Nano Banana 2.','projection-omission',[omitted,end,end])
assert not any(a.kind=='preset_draft' for a in result.artifacts)
print('PASS model-only draft cannot omit an approved field')
state = copy.deepcopy(original_state)
for approval in state['summary_json']['kernel_preset_approvals'].values():
    approval.pop('contract',None)
result = turn('Make it text-to-image instead.','projection-early-convert',[convert])
assert any(a.kind=='preset_draft' for a in result.artifacts)
result = turn('Use Nano Banana 2.','projection-early-revive',[step,end,end])
assert not any(a.kind=='preset_draft' for a in result.artifacts)
print('PASS intake-only slot approval cannot survive text-to-image conversion')
state = copy.deepcopy(original_state)
invalid = [
    ('Remove Portrait if I ask later.', 'Remove Portrait if I ask later.', 'withdraw', 'Portrait', ''),
    ('Remove Portrait?', 'Remove Portrait', 'withdraw', 'Portrait', ''),
    ('Remove nothing, keep Portrait.', 'Remove nothing, keep Portrait.', 'withdraw', 'Portrait', ''),
    ('Do not use Portrait as identity.', 'Do not use Portrait as identity.', 'approve', 'Portrait', 'identity'),
    ('Do not use Portrait as identity.', 'Portrait as identity', 'approve', 'Portrait', 'identity'),
    ('I want Portrait as identity only if I decide later.', 'I want Portrait as identity only if I decide later.', 'approve', 'Portrait', 'identity'),
    ('"Use Portrait as identity."', '"Use Portrait as identity."', 'approve', 'Portrait', 'identity'),
    ('Use Nano Banana 2.', 'Use Nano Banana 2.', 'withdraw', 'Portrait', ''),
    ('Use Nano Banana 2.', 'Use Nano Banana 2.', 'approve', 'Nano', 'Banana 2'),
]
for index,(text,source,action,label,value) in enumerate(invalid):
    bad = {'kind':'slot','key':'portrait','label':label,'role':value,'source_span':source,'action':action}
    reply = {'capability':'preset_builder','artifact_intent':'none','reply':'Please clarify the actual image role.'}
    result = turn(text,f'projection-negative-{index}',[{**reply,'guidance':{'preset_approvals':[bad]}},reply])
    assert any(x.error and x.error.code=='invalid_preset_approval' for x in result.trace.tool_calls), (text,result)
    result = turn('Use Nano Banana 2.',f'projection-negative-preserved-{index}',[step])
    assert any(a.kind=='preset_draft' for a in result.artifacts)
print('PASS negative, hypothetical, quoted, partial, unrelated-withdrawal and model-text sources rejected without erasing approvals')

for wording in ('Convert this to text-to-image.', 'Switch to text-to-image.'):
    state = copy.deepcopy(original_state)
    conversion = copy.deepcopy(convert)
    conversion['guidance']['preset_approvals'][0]['source_span'] = wording
    result = turn(wording, 'projection-lane-wording', [conversion])
    assert any(a.kind == 'preset_draft' for a in result.artifacts)
    assert not result.artifacts[0].data['draft']['input_slots_json']
print('PASS Convert and Switch lane wording through full kernel')

state = copy.deepcopy(original_state)
replacement_text = 'Replace Occupation with Profession as a text field.'
replacement = copy.deepcopy(step)
replacement['guidance'] = {'preset_approvals': [{'kind': 'field', 'key': 'occupation', 'label': 'Profession', 'role': '', 'source_span': replacement_text, 'action': 'replace'}]}
replacement['tool_call']['arguments']['draft']['input_schema_json'][0]['label'] = 'Profession'
replacement['tool_call']['arguments']['draft']['rules_json']['field_evidence']['occupation'] = replacement_text
result = turn(replacement_text, 'projection-replace', [replacement])
assert any(a.kind == 'preset_draft' for a in result.artifacts)
assert result.artifacts[0].data['draft']['input_schema_json'][1] == draft['input_schema_json'][1]
print('PASS explicit replacement preserves unrelated field')

state = copy.deepcopy(original_state)
reaffirmed = copy.deepcopy(step)
reaffirmed['guidance'] = {'preset_approvals': [{'kind': 'field', 'key': 'occupation', 'label': 'Occupation', 'role': '', 'source_span': 'Keep Occupation.', 'action': 'approve'}]}
reaffirmed['tool_call']['arguments']['draft']['input_schema_json'][0]['help_text'] = 'Controls a different unrelated visual purpose.'
result = turn('Keep Occupation.', 'projection-reaffirm-change', [reaffirmed, end, end])
assert not any(a.kind == 'preset_draft' for a in result.artifacts)
print('PASS reaffirmation cannot silently rewrite bound field contract')

state = copy.deepcopy(original_state)
cross_key = copy.deepcopy(step)
cross_key['guidance'] = {'preset_approvals': [
    {'kind': 'field', 'key': 'occupation', 'label': 'Occupation', 'role': '', 'source_span': replacement_text, 'action': 'withdraw'},
    {'kind': 'field', 'key': 'profession', 'label': 'Profession', 'role': '', 'source_span': replacement_text, 'action': 'approve'},
]}
cross_draft = cross_key['tool_call']['arguments']['draft']
cross_draft['input_schema_json'][0].update(key='profession', label='Profession')
cross_draft['prompt_template'] = cross_draft['prompt_template'].replace('{{occupation}}', '{{profession}}')
cross_draft['rules_json']['field_evidence'].pop('occupation')
cross_draft['rules_json']['field_evidence']['profession'] = replacement_text
result = turn(replacement_text, 'projection-cross-key-replace', [cross_key, end, end])
assert any(a.kind == 'preset_draft' for a in result.artifacts), 'An explicit replacement must authorize withdrawal of its named old target.'
assert result.artifacts[0].data['draft']['input_schema_json'][1] == draft['input_schema_json'][1]
print('PASS explicit replacement with new field key withdraws only the named old field')

for source in ('Replace Occupation with Profession if I ask later.', 'Replace Occupation with Profession?', 'Replace Occupation with Profession when I approve later.'):
    state = copy.deepcopy(original_state)
    conditional = copy.deepcopy(cross_key)
    for change in conditional['guidance']['preset_approvals']:
        change['source_span'] = source
    result = turn(source, 'projection-conditional-replace', [conditional, end, end])
    assert not any(a.kind == 'preset_draft' for a in result.artifacts)
    result = turn('Use Nano Banana 2.', 'projection-after-conditional-replace', [step])
    assert any(a.kind == 'preset_draft' for a in result.artifacts)
print('PASS conditional and question replacements cannot withdraw prior approval')

state = copy.deepcopy(original_state)
state['summary_json'] = {'reference_analysis_cache': reference}
help_source = f'Help me create an image-to-image preset with a required {slot["label"]} image with role {role}.'
help_fields = 'I explicitly want Occupation and Setting as text fields.'
help_intake = {'capability': 'preset_builder', 'artifact_intent': 'none', 'guidance': {'preset_approvals': [
    {'kind': 'slot', 'key': slot['key'], 'label': slot['label'], 'role': role, 'source_span': help_source, 'action': 'approve'},
    *[{'kind': 'field', 'key': field['key'], 'label': field['label'], 'role': '', 'source_span': help_fields, 'action': 'approve'} for field in draft['input_schema_json']],
]}, 'reply': 'Which image model would you like?'}
turn(help_source + ' ' + help_fields, 'projection-help-intake', [help_intake, {'capability': 'preset_builder', 'artifact_intent': 'none', 'reply': 'Which model?'}])
help_step = copy.deepcopy(step)
help_step['tool_call']['arguments']['draft']['rules_json']['runtime_image_roles'][slot['key']]['user_evidence'] = help_source
result = turn('Use Nano Banana 2.', 'projection-help-model', [help_step, end, end])
assert any(a.kind == 'preset_draft' for a in result.artifacts), 'Direct Help me create intake must survive model-only continuation.'
print('PASS direct Help me create request survives model-only continuation')
