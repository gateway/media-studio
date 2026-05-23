from __future__ import annotations

from typing import List

from .schemas import GraphNodeField


def prompt_provider_selection_fields() -> List[GraphNodeField]:
    return [
        GraphNodeField(
            id="provider",
            label="Provider",
            type="select",
            required=True,
            default="studio_default",
            advanced=True,
            options=[
                {"label": "Prompt Enhance Default Model", "value": "studio_default"},
                {"label": "OpenRouter", "value": "openrouter"},
                {"label": "Codex Local", "value": "codex_local"},
                {"label": "Local OpenAI", "value": "local_openai"},
            ],
            help_text="Uses the Prompt Enhance default model from AI Settings.",
        ),
        GraphNodeField(
            id="model_id",
            label="Model",
            type="provider_model_picker",
            required=False,
            default="",
            advanced=True,
            visible_if={"field": "provider", "not_equals": "studio_default"},
            help_text="Choose a discovered provider model. Refresh the catalog if the list is empty or stale.",
        ),
        GraphNodeField(
            id="provider_model_label",
            label="Provider Model Label",
            type="text",
            required=False,
            default="",
            advanced=True,
            hidden=True,
        ),
        GraphNodeField(
            id="provider_supports_images",
            label="Provider Supports Images",
            type="boolean",
            required=False,
            default=None,
            advanced=True,
            hidden=True,
        ),
        GraphNodeField(
            id="provider_capabilities_json",
            label="Provider Capabilities JSON",
            type="textarea",
            required=False,
            default={},
            advanced=True,
            hidden=True,
        ),
    ]


def prompt_generation_runtime_fields(
    *,
    temperature_help: str,
    temperature_placeholder: str,
    max_tokens_placeholder: str,
    max_tokens_help: str,
    include_external_variables: bool,
) -> List[GraphNodeField]:
    fields = [
        GraphNodeField(
            id="temperature",
            label="Temperature Override",
            type="float",
            required=False,
            default="",
            placeholder=temperature_placeholder,
            min=0,
            max=2,
            advanced=True,
            visible_if={"field": "provider", "not_equals": "codex_local"},
            help_text=temperature_help,
        ),
        GraphNodeField(
            id="max_tokens",
            label="Max Tokens Override",
            type="integer",
            required=False,
            default="",
            placeholder=max_tokens_placeholder,
            min=64,
            max=4000,
            advanced=True,
            visible_if={"field": "provider", "not_equals": "codex_local"},
            help_text=max_tokens_help,
        ),
    ]
    if include_external_variables:
        fields.append(
            GraphNodeField(
                id="external_variables_json",
                label="External Variables JSON",
                type="textarea",
                required=False,
                default="{}",
                placeholder='{"style_direction":"cinematic realism"}',
                advanced=True,
                help_text="Optional fallback values for unresolved template variables after connected and typed inputs.",
            )
        )
    return fields
