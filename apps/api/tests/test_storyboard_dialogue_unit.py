"""Protect storyboard dialogue/notes boundaries and exact authored speech."""
from __future__ import annotations

from app.graph.executors.prompt_ops import (
    _sanitize_storyboard_v2_prompt_text,
    _storyboard_blank_non_spoken_dialog_rows,
    _storyboard_user_disabled_dialogue,
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
