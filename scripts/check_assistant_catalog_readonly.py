import argparse, json, sqlite3
from contextlib import contextmanager
from pathlib import Path
from app import db
from app.settings import settings
parser=argparse.ArgumentParser(description='Read-only catalog discovery and bounded trace regression')
parser.add_argument('--db', type=Path, required=True)
args=parser.parse_args()
assert settings.db_path.resolve()==args.db.resolve() and args.db.is_file() and args.db.stat().st_size>0
@contextmanager
def readonly():
 c=sqlite3.connect(settings.db_path.as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;c.execute('pragma query_only=ON')
 try: yield c
 finally: c.close()
db.get_connection=readonly
from app.assistant.kernel_tools import execute_kernel_tool, KernelToolContext
context=KernelToolContext(workflow=None,canvas_context={})
result=execute_kernel_tool(tool_name='list_graph_node_types',arguments={'query':'media.save_image','limit':6},capability='graph_builder',context=context)
assert result.trace.error is None
assert 'media.save_image' in [n['type'] for n in result.result['node_types']]
assert result.trace.evidence and result.trace.evidence['arguments']=={'query':'media.save_image','limit':6}, 'Catalog trace lacks bounded query/coverage evidence'
assert 'media.save_image' in [n['type'] for n in result.trace.evidence['nodes']]
assert all('fields' not in n and 'ports' not in n for n in result.trace.evidence['nodes'])
second=execute_kernel_tool(tool_name='inspect_graph_node_schemas',arguments={'node_types':['media.save_image']},capability='graph_builder',context=context)
assert second.trace.error is None and second.trace.evidence['nodes'][0]['type']=='media.save_image'
print('PASS bounded catalog coverage evidence, normal discovery and separate schema inspection')

exact=execute_kernel_tool(tool_name='list_graph_node_types',arguments={'query':'gpt-image-2-5-sunburst-image-to-image','limit':1},capability='graph_builder',context=context)
assert exact.result['node_types'][0]['type']=='model.kie.gpt_image_2_5_sunburst_image_to_image', 'Exact selected model key must rank ahead of similar model variants.'
print('PASS exact model-key discovery with one result')

# Supplemental unset-default projection changes only this process's reader.
from unittest.mock import patch
from app import service_image_models, store
from app.service_errors import ServiceError
configured=service_image_models.assistant_image_model_defaults()
assert configured.get('image_to_image')
assert service_image_models.resolve_image_model('image_to_image').source['model_key']==configured['image_to_image']
original=store.get_prompt_recipe_drafting_config
with patch.object(store, 'get_prompt_recipe_drafting_config', side_effect=lambda key: {**(original(key) or {}), 'image_model_defaults_json': {}}):
    models=execute_kernel_tool(tool_name='list_media_models', arguments={'model_key':configured['image_to_image']}, capability='graph_builder',context=context)
    assert models.trace.error is None and models.result['image_model_defaults']=={}
    assert models.result['models'][0]['model_key']==configured['image_to_image']
    try: service_image_models.resolve_image_model('image_to_image')
    except ServiceError as error: assert 'Choose' in str(error)
    else: raise AssertionError('Unset defaults silently chose a model')
    assert service_image_models.resolve_image_model('image_to_image',configured['image_to_image'])
assert service_image_models.assistant_image_model_defaults()==configured
print('PASS supplemental unset defaults: no silent choice, explicit discovery retained, persisted settings unchanged')
