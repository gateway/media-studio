from __future__ import annotations

from typing import Any, Dict, Optional

from .. import store


def emit(run_id: str, event_type: str, payload: Optional[Dict[str, Any]] = None, node_id: Optional[str] = None) -> Dict[str, Any]:
    return store.append_graph_run_event(run_id, event_type, payload or {}, node_id=node_id)
