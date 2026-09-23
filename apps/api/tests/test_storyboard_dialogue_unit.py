"""Protect storyboard dialogue/notes boundaries and exact authored speech."""
from __future__ import annotations

from app.graph.executors.prompt_ops import (
    _sanitize_storyboard_v2_prompt_text,
    _storyboard_blank_non_spoken_dialog_rows,
    _storyboard_user_disabled_dialogue,
    _storyboard_preserve_requested_action_beats,
)


def test_empty_dialogue_does_not_consume_notes_or_next_panel() -> None:
    text = "PANEL 01\nDIALOG:\nNOTES: Keep the mug centered.\n\nPANEL 02\nDIALOG: None\nNOTES: Bell on impact."
    for force in (False, True):
        result = _storyboard_blank_non_spoken_dialog_rows(text, force_no_dialogue=force)
        assert "NOTES: Keep the mug centered." in result
        assert "NOTES: Bell on impact." in result
        assert "PANEL 02" in result
        assert "None" not in result


def test_exact_dialogue_survives_negative_metadata_routing_instruction() -> None:
    values = {
        "user_prompt": "Make six panels. Sound cues belong in NOTES, not DIALOG.",
        "dialogue_cues": 'PANEL 06 — HOST — "Now that’s a strong coffee."',
    }
    assert not _storyboard_user_disabled_dialogue(values)
    assert _storyboard_user_disabled_dialogue({"user_prompt": "Make a silent commercial with no dialogue."})
    panels = "\n\n".join(
        f"PANEL {n:02d}\nSHOT: {n:02d} Coffee beat\nCAMERA: eye-level, locked-off, 50mm\n"
        "ACTION: The host studies the mug.\nMOTION: Steam rises slowly.\n"
        + ('DIALOG: HOST — "Now that’s a strong coffee."\n' if n == 6 else "DIALOG:\n")
        + f"NOTES: Preserve the prop position for beat {n}."
        for n in range(1, 7)
    )
    sanitized = _sanitize_storyboard_v2_prompt_text(panels, values, fill_missing_generated_rows=False)
    assert 'DIALOG: HOST — "Now that’s a strong coffee."' in sanitized
    for n in range(1, 7):
        assert f"PANEL {n:02d}" in sanitized
        assert f"NOTES: Preserve the prop position for beat {n}." in sanitized


def test_action_reminder_respects_display_limits_and_preserves_continuity() -> None:
    notes = "Keep the bent spoon visible and bottle cap open; label faces camera, illustrated figure stays printed, and nobody drinks."
    action = "The host calmly stirs with the tiny barbell and delivers the final line."
    values = {"user_prompt": "host opens red flip-top cap."}
    text = f"PANEL 06\nACTION: {action}\nNOTES: {notes}"
    result = _storyboard_preserve_requested_action_beats(text, values)
    assert f"NOTES: {notes}" in result
    assert "host opens red flip-top cap" in result
    for line in result.splitlines():
        if line.startswith("ACTION:"):
            assert len(line.partition(":")[2].strip()) <= 136
    full = text.replace(action, "The host studies the mug carefully while holding a tiny barbell above the coffee and maintaining a calm expression throughout the beat.")
    for prefix in ("", "PROP AND STATE CONTINUITY: Preserve the mug position.\n\n"):
        result = _storyboard_preserve_requested_action_beats(prefix + full, values)
        assert f"NOTES: {notes}" in result
        assert result.count("PROP AND STATE CONTINUITY:") == 1
        assert "host opens red flip-top cap" in result
        if prefix:
            assert "Preserve the mug position." in result
