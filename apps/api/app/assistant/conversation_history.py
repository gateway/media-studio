"""Read-only, session-owned recovery of saved conversation and graph proposals."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Literal, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

from .. import store_assistant
from .tool_limits import KERNEL_TOOL_RESULT_MAX_BYTES


class SearchConversationArguments(BaseModel):
    query: str = Field(default="", max_length=200, description="Literal phrase to find in full saved messages; empty lists recent messages.")
    before_message_id: Optional[str] = Field(default=None, max_length=120)
    limit: int = Field(default=8, ge=1, le=8)


class ReadSessionContentArguments(BaseModel):
    source_kind: Literal["message", "graph_proposal"]
    source_id: str = Field(min_length=1, max_length=120)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=12000, ge=1, le=12000)
    version: Optional[str] = Field(default=None, min_length=64, max_length=64, description="Copy the returned version for subsequent pages; a changed source is rejected.")


def _session_id(context: Any) -> str:
    session_id = str(context.session_id or "")
    if not session_id or not store_assistant.get_assistant_session(session_id):
        raise HTTPException(404, "This assistant conversation is unavailable.")
    return session_id


def search_conversation(arguments: SearchConversationArguments, context: Any) -> dict[str, Any]:
    session_id = _session_id(context)
    try:
        return store_assistant.search_assistant_conversation(
            session_id, query=arguments.query,
            before_message_id=arguments.before_message_id, limit=arguments.limit,
        )
    except KeyError:
        raise HTTPException(404, "That conversation page is unavailable in this session.") from None


def read_session_content(arguments: ReadSessionContentArguments, context: Any) -> dict[str, Any]:
    session_id = _session_id(context)
    if arguments.source_kind == "message":
        record = store_assistant.get_assistant_message(arguments.source_id)
        if (not record or record.get("assistant_session_id") != session_id
                or record.get("role") not in {"user", "assistant"}):
            raise HTTPException(404, "That saved content is unavailable in this conversation.")
        text = str(record.get("content_text") or "")
        metadata = {"role": record["role"], "created_at": record["created_at"], "content_format": "text"}
        payload = record.get("content_json")
        action = payload.get("next_action") if isinstance(payload, dict) else None
        proposal_id = action.get("proposal_id") if isinstance(action, dict) else None
        metadata["related_proposal_id"] = proposal_id if isinstance(proposal_id, str) and 0 < len(proposal_id) <= 120 else None
    else:
        record = store_assistant.get_assistant_plan(arguments.source_id)
        if not record or record.get("assistant_session_id") != session_id:
            raise HTTPException(404, "That saved content is unavailable in this conversation.")
        # Expose the saved content, not confirmation tokens or replayable actions.
        text = json.dumps(record.get("workflow_json") or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        metadata = {
            "status": record.get("status"), "created_at": record["created_at"],
            "updated_at": record["updated_at"], "content_format": "workflow_json",
        }
    version = hashlib.sha256(json.dumps({"text": text, **metadata}, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    if arguments.offset and not arguments.version:
        raise HTTPException(409, "Continue reading with the version returned by the first page.")
    if arguments.version is not None and arguments.version != version:
        raise HTTPException(409, "The saved content changed. Read it again from offset zero before reusing it.")
    if arguments.offset > len(text):
        raise HTTPException(400, "The requested offset is past the end of this saved content.")
    end = min(len(text), arguments.offset + arguments.limit)
    while True:
        result = {
            "source_kind": arguments.source_kind, "source_id": arguments.source_id,
            **metadata, "version": version, "offset": arguments.offset,
            "text": text[arguments.offset:end], "total_chars": len(text),
            "next_offset": end if end < len(text) else None, "complete": end == len(text),
        }
        # Match the kernel's JSON byte accounting, including Unicode escaping.
        # Smaller pages retain an explicit continuation; no source text is lost.
        if len(json.dumps(result, sort_keys=True, separators=(",", ":")).encode("utf-8")) <= KERNEL_TOOL_RESULT_MAX_BYTES:
            return result
        if end <= arguments.offset + 1:
            raise HTTPException(413, "The saved content metadata is too large to return safely.")
        end = arguments.offset + (end - arguments.offset) // 2
