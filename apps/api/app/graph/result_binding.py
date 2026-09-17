"""Exact completed-output identity shared by assistant selection and graph validation."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from .. import store
from .media_refs import graph_ref_path
from .schemas import GraphOutputRef


def artifact_version(artifact: dict) -> tuple[str, Any]:
    path = None
    file_version = None
    if artifact.get('media_type') in {'image', 'video', 'audio'}:
        path = graph_ref_path(GraphOutputRef.model_validate(artifact), expected_media_type=artifact['media_type'])
        stat = path.stat()
        file_version = [str(path), stat.st_size, stat.st_mtime_ns]
    version = hashlib.sha256(json.dumps([artifact, file_version], sort_keys=True, default=str).encode()).hexdigest()
    return version, path


def validate_result_binding(node: Any) -> None:
    binding = node.metadata.get('source_result')
    if not binding:
        return
    if not isinstance(binding, dict) or binding.get('schema_version') != 1 or not binding.get('run_id') or not binding.get('artifact_id'):
        raise ValueError('Completed result provenance is invalid. Select the result again.')
    artifact = next((item for item in store.list_graph_artifacts_for_run(binding['run_id'])
                     if item['artifact_id'] == binding['artifact_id']), None)
    if not artifact or artifact_version(artifact)[0] != binding.get('version'):
        raise ValueError('A reused result is missing or changed. Select it again and review a fresh stage; nothing will regenerate.')
    statuses = {item['node_id']: item['status'] for item in store.list_graph_run_nodes(binding['run_id'])}
    if statuses.get(artifact['node_id']) not in {'completed', 'cached'}:
        raise ValueError('The reused output is not a completed result.')
    text = (artifact.get('value_json') or {}).get('value')
    expected_type = 'prompt.text' if isinstance(text, str) else 'media.load_' + str(artifact.get('media_type'))
    expected = {'text': text} if isinstance(text, str) else {key: artifact.get(key) or None for key in ('asset_id', 'reference_id')}
    if node.type != expected_type or any((node.fields.get(key) or None) != (value or None) for key, value in expected.items()):
        raise ValueError('A completed result must be loaded unchanged. Put revisions in a new generator.')
