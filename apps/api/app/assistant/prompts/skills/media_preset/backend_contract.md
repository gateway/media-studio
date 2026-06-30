# Media Preset Backend Contract

Use this section when the provider must return a structured Media Preset style brief. Keep this contract compatible with the current Media Studio parser.

Backend-only structured brief:

For reference-image-to-Media-Preset requests, append this backend-only JSON block after the compact visible reply so Media Studio can compile a real prompt. Do not mention this block in the visible reply.

```text
REFERENCE_STYLE_BRIEF_JSON_START
{
  "title": "specific reusable style name",
  "summary": "one sentence",
  "description": "one user-facing sentence about what the preset creates",
  "key": "specific_reusable_style_key",
  "workflow_key": "media_preset.specific.reusable.style.v1",
  "target_model_mode": "text_to_image or image_edit",
  "preset_kind": "generator or image_transform or pipeline",
  "input_mode": "no_image or image_required or image_optional",
  "visual_analysis": {
    "medium": ["concrete visible trait"],
    "palette": ["concrete visible trait"],
    "line_shape_language": ["concrete visible trait"],
    "composition": ["concrete visible trait"],
    "subject_treatment": ["concrete visible trait"],
    "environment_props": ["concrete visible trait"],
    "texture_lighting": ["concrete visible trait"],
    "typography_text_energy": ["concrete visible trait"],
    "mood": ["concrete visible trait"]
  },
  "fixed_style_traits": ["reusable style mechanic"],
  "replaceable_elements": ["likely field or image input"],
  "source_specific_exclusions": ["visible source detail that should not become fixed style"],
  "negative_guidance": ["common drift to avoid"],
  "recommended_fields": [
    {"key": "snake_case_key", "label": "User Facing Label", "purpose": "why this field changes the result", "default_value": "", "required": true}
  ],
  "recommended_image_slots": [
    {"key": "snake_case_key", "label": "User Facing Label", "purpose": "what user-provided image replaces or controls", "required": true}
  ],
  "verification_targets": {
    "must_match": ["style traits output must preserve"],
    "may_vary": ["things the generated image may change"],
    "must_not_copy": ["exact source text, logos, identity, pose, or layout"]
  }
}
REFERENCE_STYLE_BRIEF_JSON_END
```

Rules:

- Every `visual_analysis` item must be a concrete visible trait from the attached image.
- Use multiple items per category when the image is dense.
- `fixed_style_traits` are reusable style mechanics, not source-specific content.
- `replaceable_elements` are likely fields or image inputs.
- `recommended_fields` and `recommended_image_slots` must be minimal, concrete, and user-facing; omit either array when the chosen variant should not use them.
- `key` and `workflow_key` must come from the analyzed reusable style, not a filename or prior style.
- Do not put user instructions, questions, model names, product wording, or workflow wording in this JSON.
- `source_specific_exclusions` must list details that should not become fixed style.
