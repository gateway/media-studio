from __future__ import annotations
"""Session-owned views over existing graph output artifacts. Never executes nodes."""
from urllib.parse import quote
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..graph.result_binding import artifact_version, validate_result_binding
from ..settings import settings

from .. import store, store_assistant
from .limits import ASSISTANT_IMAGE_ATTACHMENT_LIMIT


def session_owns_run(session: dict, run: dict) -> bool:
    """Recognize workflow ownership and server-recorded confirmed run associations."""
    summary = session.get('summary_json') or {}
    confirmation = summary.get('kernel_run_confirmation') or {}
    return (
        session.get('owner_kind') == 'graph_workflow'
        and session.get('owner_id') == run.get('workflow_id')
    ) or run.get('run_id') == confirmation.get('assistant_run_id') or run.get('run_id') in (summary.get('result_runs') or {})


def owned_run(session_id: str, run_id: str) -> tuple[dict, dict]:
    session = store_assistant.get_assistant_session(session_id)
    run = store.get_graph_run(run_id)
    if not session or not run:
        raise HTTPException(status_code=404, detail='The assistant session or run is unavailable.')
    owned = session_owns_run(session, run)
    if not owned:
        raise HTTPException(status_code=409, detail='This run does not belong to this assistant conversation. Open its workflow to select a result.')
    return session, run


def read_run_results(session_id: str, run_id: str) -> dict[str, Any]:
    session, run = owned_run(session_id, run_id)
    workflow = run.get('workflow_json') or {}
    nodes = {node['id']: node for node in workflow.get('nodes') or []}
    statuses = {node['node_id']: node['status'] for node in store.list_graph_run_nodes(run_id)}
    items = []
    for artifact in store.list_graph_artifacts_for_run(run_id):
        node = nodes.get(artifact['node_id'], {})
        value = (artifact.get('value_json') or {}).get('value')
        text = value if isinstance(value, str) else None
        media_type = artifact.get('media_type')
        if text is None and media_type not in {'image', 'video', 'audio'}:
            continue
        available = statuses.get(artifact['node_id']) in {'completed', 'cached'}
        url = None
        try:
            version, path = artifact_version(artifact)
            if path:
                url = '/api/control/files/' + quote(str(path.relative_to(settings.data_root.resolve())), safe='/')
        except (ValueError, OSError):
            available = False
            version = 'unavailable'
        items.append({
            **{key: artifact.get(key) for key in ('artifact_id', 'workflow_id', 'run_id', 'node_id', 'node_type', 'output_port', 'output_index', 'kind', 'media_type', 'asset_id', 'reference_id', 'created_at')},
            'node_title': ((node.get('metadata') or {}).get('ui') or {}).get('customTitle') or node.get('type') or artifact['node_id'],
            'text': text, 'available': available, 'url': url, 'version': version,
            'blocker': None if available else 'This output is unavailable; select another completed result.',
        })
    return {
        'run_id': run_id, 'workflow_id': run.get('workflow_id'), 'workflow_name': workflow.get('name'),
        'status': run.get('status'), 'error': run.get('error'), 'items': items,
        'selected_artifact_ids': list(((session.get('summary_json') or {}).get('selected_results') or {}).keys()),
        'selected_result_bindings': (session.get('summary_json') or {}).get('selected_results') or {},
    }


class ResultSelection(BaseModel):
    run_id: str = Field(min_length=1, max_length=120)
    artifact_id: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=64)
    selected: bool = True


def select_run_result(session_id: str, payload: ResultSelection) -> dict:
    response = read_run_results(session_id, payload.run_id)
    item = next((item for item in response['items'] if item['artifact_id'] == payload.artifact_id), None)
    if payload.selected and (not item or not item['available'] or item['version'] != payload.version):
        raise HTTPException(status_code=409, detail='That exact result is unavailable or changed. Refresh results and select again; nothing will regenerate.')
    try:
        response['selected_artifact_ids'] = store_assistant.set_assistant_result_selection(
            session_id, payload.artifact_id, {'run_id': payload.run_id, 'version': payload.version} if payload.selected else None)
        response['selected_result_bindings'] = (store_assistant.get_assistant_session(session_id).get('summary_json') or {}).get('selected_results') or {}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return response


def selected_results(session_id: str, artifact_ids: Optional[set[str]] = None) -> list[dict]:
    session = store_assistant.get_assistant_session(session_id) or {}
    selections = (session.get('summary_json') or {}).get('selected_results') or {}
    resolved = []
    runs = {}
    for artifact_id, binding in selections.items():
        if artifact_ids is not None and artifact_id not in artifact_ids:
            continue
        run_id = binding['run_id']
        if run_id not in runs:
            runs[run_id] = read_run_results(session_id, run_id)
        item = next((item for item in runs[run_id]['items'] if item['artifact_id'] == artifact_id), None)
        if not item or not item['available'] or item['version'] != binding['version']:
            raise HTTPException(status_code=409, detail='A selected result is missing or changed. Select it again or choose another result; nothing will regenerate.')
        resolved.append(item)
    return resolved


def clear_result_selection(session_id: str) -> dict:
    if not store_assistant.get_assistant_session(session_id):
        raise HTTPException(status_code=404, detail='The assistant session is unavailable.')
    store_assistant.set_assistant_result_selection(session_id, None, None)
    return {'selected_artifact_ids': []}


router = APIRouter()
router.add_api_route('/sessions/{session_id}/results/selection', clear_result_selection, methods=['DELETE'])
router.add_api_route('/sessions/{session_id}/runs/{run_id}/results', read_run_results, methods=['GET'])
router.add_api_route('/sessions/{session_id}/results/selection', select_run_result, methods=['POST'])


class ResultReuse(BaseModel):
    artifact_id: str = Field(min_length=1, max_length=120)
    node_ref: str = Field(min_length=1, max_length=120)
    title: Optional[str] = None


def stage_result_operations(session_id: str, reuse: list[ResultReuse]) -> tuple[list, list]:
    from .schemas import AssistantGraphOperation
    selected = {item['artifact_id']: item for item in selected_results(session_id, {item.artifact_id for item in reuse})}
    operations, bindings = [], []
    if len({item.node_ref for item in reuse}) != len(reuse):
        raise ValueError('Each reused result needs its own node reference.')
    for index, request in enumerate(reuse):
        item = selected.get(request.artifact_id)
        if not item:
            raise ValueError('Select the exact completed result before reusing it in a new stage.')
        node_type = 'prompt.text' if item['text'] is not None else 'media.load_' + str(item['media_type'])
        fields = {'text': item['text']} if item['text'] is not None else {
            key: item[key] for key in ('asset_id', 'reference_id') if item.get(key)
        }
        operations.append(AssistantGraphOperation(op='add_node', node_ref=request.node_ref, node_type=node_type,
            title=request.title or item['node_title'] + ' — completed result', fields=fields, position={'x': 0, 'y': index * 400}))
        bindings.append({'artifact_id': request.artifact_id, 'run_id': item['run_id'], 'version': item['version'], 'node_ref': request.node_ref, 'fields': fields})
    return operations, bindings


def validate_stage_results(session_id: str, workflow: Any, bindings: list[dict]) -> None:
    selected = {item['artifact_id']: item for item in selected_results(session_id, {item['artifact_id'] for item in bindings})}
    for binding in bindings:
        current = selected.get(binding['artifact_id'])
        if not current or current['version'] != binding['version']:
            raise ValueError('A reused result changed after review. Select again and request a fresh stage.')
        matches = [node for node in workflow.nodes if (node.metadata.get('assistant') or {}).get('semantic_ref') == binding['node_ref']]
        if len(matches) != 1:
            raise ValueError('A completed result must have its own loader.')
        matches[0].metadata['source_result'] = {'schema_version': 1, **{key: binding[key] for key in ('artifact_id', 'run_id', 'version')}}
        validate_result_binding(matches[0])



class ReadResultsArguments(BaseModel):
    run_id: Optional[str] = Field(default=None, max_length=120)


class InspectSelectedResultArguments(BaseModel):
    artifact_id: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=64)
    text_offset: int = Field(default=0, ge=0)
    text_limit: int = Field(default=4000, ge=1, le=4000)
    focus: str = Field(default="", max_length=1000)
    reference_ids: list[str] = Field(default_factory=list, max_length=ASSISTANT_IMAGE_ATTACHMENT_LIMIT)


def _selected_result(session_id: str, artifact_id: str, version: str) -> dict:
    items = selected_results(session_id, {artifact_id})
    if len(items) != 1 or items[0]['version'] != version:
        raise HTTPException(status_code=409, detail='Select this exact completed result before inspecting it. Missing or changed results cannot be inspected.')
    return items[0]


def inspect_selected_result(arguments: InspectSelectedResultArguments, context: Any) -> dict:
    session_id = str(context.session_id or '')
    item = _selected_result(session_id, arguments.artifact_id, arguments.version)
    identity = {key: item[key] for key in ('artifact_id', 'run_id', 'version', 'media_type')}
    if item.get('text') is not None:
        text = item['text']
        start = arguments.text_offset
        if start > len(text):
            raise HTTPException(status_code=400, detail='Text offset is beyond the completed result.')
        end = min(len(text), start + arguments.text_limit)
        return {**identity, 'text': text[start:end], 'text_offset': start,
                'total_characters': len(text), 'next_offset': end if end < len(text) else None}
    if item['media_type'] != 'image':
        raise HTTPException(status_code=400, detail='Inspection currently supports completed text and images only.')
    from .reference_analysis import analyze_result_image

    analysis = analyze_result_image(item, arguments, context)
    # Selection and file versions may change while the vision request is running.
    _selected_result(session_id, arguments.artifact_id, arguments.version)
    return {**identity, 'analysis': analysis, 'quality_approval': False}


def read_results_tool(arguments: ReadResultsArguments, context: Any) -> dict:
    run_id = arguments.run_id or context.run_id or ((context.session.get('summary_json') or {}).get('kernel_run_confirmation') or {}).get('assistant_run_id')
    if not run_id:
        raise HTTPException(status_code=409, detail='Select a run in this workflow before reading results.')
    result = read_run_results(str(context.session_id or ''), run_id)
    # Full exact text is available in the card and is materialized on the server.
    # Keep tool replies bounded; never ask the model to reconstruct truncated text.
    result['omitted_result_count'] = max(0, len(result['items']) - 24)
    result['items'] = [{**item, 'text': item['text'][:1200] if item.get('text') else item.get('text'),
                        'text_truncated': bool(item.get('text') and len(item['text']) > 1200)} for item in result['items'][:24]]
    return result


def select_result_tool(arguments: ResultSelection, context: Any) -> dict:
    response = select_run_result(str(context.session_id or ''), arguments)
    return {'selected_artifact_ids': response['selected_artifact_ids'], 'run_id': response['run_id']}
