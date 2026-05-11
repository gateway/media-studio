from __future__ import annotations

from typing import Dict, List

from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


class PromptTextExecutor(GraphExecutor):
    node_type = "prompt.text"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        text = str(node.fields.get("text") or "").strip()
        if not text:
            raise ValueError("Prompt Text requires text.")
        return {"text": [GraphOutputRef(kind="value", value=text, metadata={"type": "text"})]}
