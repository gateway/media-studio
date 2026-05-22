from __future__ import annotations

from typing import List

from .schemas import GraphNodeDefinition, GraphNodeField


def utility_node_definitions() -> List[GraphNodeDefinition]:
    return [
        GraphNodeDefinition(
            type="utility.note",
            title="Note",
            description="Add a Markdown note to the workflow canvas.",
            help_text="Use this as a scratch pad for instructions, reminders, or workflow notes. It has no inputs or outputs.",
            category="Utility",
            search_aliases=["note", "notes", "markdown", "scratchpad", "notepad", "comment"],
            tags=["utility", "note", "markdown"],
            source={"kind": "system"},
            execution={"executor": "utility.note", "mode": "sync", "cacheable": True, "output_node": False},
            limits={"max_inputs": 0},
            ui={
                "default_size": {"width": 360, "height": 320},
                "min_size": {"width": 260, "height": 220},
                "max_size": {"width": 1200, "height": 1600},
                "accent": "yellow",
                "icon": "text",
                "markdown_preview_field": "body",
            },
            ports={"inputs": [], "outputs": []},
            fields=[
                GraphNodeField(
                    id="body",
                    label="Note",
                    type="textarea",
                    required=False,
                    default="",
                    placeholder="Write notes in Markdown...",
                ),
            ],
        ),
    ]
