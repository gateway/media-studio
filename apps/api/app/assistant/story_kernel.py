from __future__ import annotations

import re
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field

from .. import store_assistant


class StoryKernelError(Exception):
    def __init__(self, *, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class StoryCharacter(BaseModel):
    character_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-z][a-z0-9_]*$")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1200)
    continuity_traits: list[str] = Field(default_factory=list, max_length=16)
    reference_ids: list[str] = Field(default_factory=list, max_length=8)


class StoryShot(BaseModel):
    shot_number: int = Field(ge=1, le=12)
    title: str = Field(default="", max_length=160)
    story_beat: str = Field(min_length=1, max_length=1200)
    prompt: str = Field(min_length=1, max_length=2400)
    camera: str = Field(default="", max_length=500)
    action: str = Field(default="", max_length=800)
    motion: str = Field(default="", max_length=500)
    environment: str = Field(default="", max_length=800)
    character_ids: list[str] = Field(default_factory=list, max_length=8)
    continuity_notes: list[str] = Field(default_factory=list, max_length=16)


class KernelStoryState(BaseModel):
    version: Literal[1] = 1
    status: Literal["draft", "approved"] = "draft"
    title: str = Field(default="", max_length=160)
    premise: str = Field(min_length=1, max_length=1600)
    tone: str = Field(default="", max_length=600)
    visual_style: str = Field(default="", max_length=1000)
    world_rules: list[str] = Field(default_factory=list, max_length=16)
    continuity_facts: list[str] = Field(default_factory=list, max_length=24)
    characters: list[StoryCharacter] = Field(default_factory=list, max_length=8)
    segment_title: str = Field(default="Opening sequence", max_length=160)
    shots: list[StoryShot] = Field(default_factory=list, max_length=12)
    source_reference_ids: list[str] = Field(default_factory=list, max_length=8)


class ReadStoryStateArguments(BaseModel):
    pass


class UpdateStoryStateArguments(BaseModel):
    state: KernelStoryState
    update_kind: Literal[
        "story_development",
        "shot_list",
        "shot_revision",
        "continuity",
        "reference_seed",
    ]
    revised_shot_numbers: list[int] = Field(default_factory=list, max_length=12)


def _session_state(context: Any) -> tuple[Dict[str, Any], Dict[str, Any], Optional[Dict[str, Any]]]:
    session = (
        store_assistant.get_assistant_session(context.session_id)
        if context.session_id
        else None
    ) or dict(context.session or {})
    summary = dict(session.get("summary_json") or {})
    state = summary.get("kernel_story_state")
    return session, summary, dict(state) if isinstance(state, dict) else None


def read_story_state(_arguments: BaseModel, context: Any) -> Dict[str, Any]:
    _session, _summary, state = _session_state(context)
    return {"exists": state is not None, "state": state}


def _requested_shot_count(user_text: str) -> Optional[int]:
    number_words = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "nine": 9,
        "ten": 10,
        "eleven": 11,
        "twelve": 12,
    }
    match = re.search(
        r"\b(?:(\d{1,2})|(" + "|".join(number_words) + r"))\s+(?:shots?|scenes?)\b",
        str(user_text or ""),
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    count = int(match.group(1)) if match.group(1) else number_words[match.group(2).lower()]
    return count if 1 <= count <= 12 else None


def _requested_revision_shots(user_text: str) -> list[int]:
    return sorted(
        {
            int(match.group(1))
            for match in re.finditer(
                r"\b(?:shot|scene)\s+(\d{1,2})\b",
                str(user_text or ""),
                flags=re.IGNORECASE,
            )
            if 1 <= int(match.group(1)) <= 12
        }
    )


def _shot_map(state: KernelStoryState) -> Dict[int, Dict[str, Any]]:
    return {
        shot.shot_number: shot.model_dump(mode="json")
        for shot in state.shots
    }


def _validate_sequence(state: KernelStoryState, *, requested_count: Optional[int]) -> None:
    numbers = [shot.shot_number for shot in state.shots]
    if numbers and numbers != list(range(1, len(numbers) + 1)):
        raise StoryKernelError(
            code="story_shots_not_sequential",
            message="Story shots must be numbered sequentially from 1.",
        )
    if requested_count is not None and len(numbers) != requested_count:
        raise StoryKernelError(
            code="story_shot_count_mismatch",
            message=f"The user requested exactly {requested_count} shots, but the typed state has {len(numbers)}.",
        )
    character_ids = {character.character_id for character in state.characters}
    unknown = sorted(
        {
            character_id
            for shot in state.shots
            for character_id in shot.character_ids
            if character_id not in character_ids
        }
    )
    if unknown:
        raise StoryKernelError(
            code="story_character_reference_invalid",
            message=f"Shots reference unknown character ids: {', '.join(unknown)}.",
        )


def _validate_shot_revision(
    current: KernelStoryState,
    updated: KernelStoryState,
    *,
    requested: list[int],
    declared: list[int],
) -> list[int]:
    if not requested:
        raise StoryKernelError(
            code="story_revision_target_missing",
            message="Name the shot number being revised.",
        )
    if sorted(set(declared)) != requested:
        raise StoryKernelError(
            code="story_revision_scope_mismatch",
            message="The declared revised shot numbers must match the user's requested shot.",
        )
    current_payload = current.model_dump(mode="json")
    updated_payload = updated.model_dump(mode="json")
    current_payload.pop("shots", None)
    updated_payload.pop("shots", None)
    if current_payload != updated_payload:
        raise StoryKernelError(
            code="story_revision_changed_project",
            message="A single-shot revision must preserve the story bible, characters, style, and continuity facts.",
        )
    before = _shot_map(current)
    after = _shot_map(updated)
    if before.keys() != after.keys():
        raise StoryKernelError(
            code="story_revision_changed_shot_set",
            message="A single-shot revision must preserve the existing shot set.",
        )
    changed = sorted(number for number in before if before[number] != after[number])
    if changed != requested:
        raise StoryKernelError(
            code="story_revision_changed_wrong_shots",
            message=f"Only shot {requested[0]} may change in this revision.",
        )
    return changed


def _without_continuity(shot: Dict[str, Any]) -> Dict[str, Any]:
    return {
        key: value
        for key, value in shot.items()
        if key not in {"character_ids", "continuity_notes"}
    }


def _validate_continuity_update(
    current: KernelStoryState,
    updated: KernelStoryState,
) -> list[int]:
    current_payload = current.model_dump(mode="json")
    updated_payload = updated.model_dump(mode="json")
    for key in ("continuity_facts", "characters", "shots"):
        current_payload.pop(key, None)
        updated_payload.pop(key, None)
    if current_payload != updated_payload:
        raise StoryKernelError(
            code="story_continuity_changed_project",
            message="A continuity update must preserve the premise, tone, style, world rules, and segment.",
        )
    before = _shot_map(current)
    after = _shot_map(updated)
    if before.keys() != after.keys():
        raise StoryKernelError(
            code="story_continuity_changed_shot_set",
            message="A continuity update must preserve the existing shot set.",
        )
    if any(_without_continuity(before[number]) != _without_continuity(after[number]) for number in before):
        raise StoryKernelError(
            code="story_continuity_changed_story_content",
            message="A continuity update may change only character links and continuity notes within shots.",
        )
    return sorted(number for number in before if before[number] != after[number])


def update_story_state(arguments: BaseModel, context: Any) -> Dict[str, Any]:
    options = UpdateStoryStateArguments.model_validate(arguments)
    if not context.session_id:
        raise StoryKernelError(
            code="story_session_unavailable",
            message="Typed story state requires an active assistant session.",
            retryable=False,
        )
    session, summary, current_payload = _session_state(context)
    current = KernelStoryState.model_validate(current_payload) if current_payload else None
    requested_count = _requested_shot_count(context.user_text)
    _validate_sequence(options.state, requested_count=requested_count)

    changed_shots = sorted(_shot_map(options.state))
    if options.update_kind == "shot_revision":
        if current is None:
            raise StoryKernelError(
                code="story_revision_state_missing",
                message="Create the typed shot list before revising an individual shot.",
            )
        changed_shots = _validate_shot_revision(
            current,
            options.state,
            requested=_requested_revision_shots(context.user_text),
            declared=options.revised_shot_numbers,
        )
    elif options.update_kind == "continuity" and current is not None:
        changed_shots = _validate_continuity_update(current, options.state)
    elif options.update_kind == "shot_list" and not options.state.shots:
        raise StoryKernelError(
            code="story_shot_list_empty",
            message="A shot-list update must contain structured shots.",
        )

    state = options.state.model_dump(mode="json")
    summary["kernel_story_state"] = state
    snapshot = dict(session.get("state_snapshot_json") or {})
    snapshot["kernel_story_state"] = state
    store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": summary,
            "state_snapshot_json": snapshot,
        }
    )
    return {
        "valid": True,
        "update_kind": options.update_kind,
        "changed_shot_numbers": changed_shots,
        "state": state,
    }
