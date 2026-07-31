from __future__ import annotations

import hashlib
import hmac

from fastapi import HTTPException

from .. import store_assistant
from .kernel_tools import workflow_fingerprint
from .schemas import AssistantRunConfirmationRequest


def confirm_kernel_run_action(
    session_id: str,
    payload: AssistantRunConfirmationRequest,
) -> dict[str, bool]:
    session = store_assistant.get_assistant_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="assistant session not found")
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    confirmation = summary.get("kernel_run_confirmation")
    if not isinstance(confirmation, dict) or confirmation.get("consumed") is True:
        raise HTTPException(status_code=400, detail="This run confirmation is no longer available.")
    supplied_hash = hashlib.sha256(payload.confirmation_token.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(str(confirmation.get("confirmation_token_hash") or ""), supplied_hash):
        raise HTTPException(status_code=400, detail="This run confirmation is invalid.")
    if not hmac.compare_digest(
        str(confirmation.get("workflow_fingerprint") or ""),
        workflow_fingerprint(payload.workflow),
    ):
        raise HTTPException(
            status_code=400,
            detail="The graph changed after this run confirmation was prepared.",
        )
    store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                **summary,
                "kernel_run_confirmation": {
                    **confirmation,
                    "consumed": True,
                },
            },
        }
    )
    return {"confirmed": True}
