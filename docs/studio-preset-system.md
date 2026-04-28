# Studio Preset System

Media Studio presets are reusable generation recipes. A preset is not a model; it is a structured layer on top of a supported model that defines:

- which Nano Banana models it can run on
- the prompt template
- the text fields a user must fill in
- the image slots a user must provide
- optional default options, notes, thumbnail metadata, and import/export metadata

The current structured preset path is intentionally focused on Nano Banana image workflows. Standard Kling/Seedance composer slots are handled by the standard composer slot contract, not by this preset renderer.

## Data Model

Preset records live in the local SQLite `media_presets` table.

Core fields:

- `preset_id`: stable internal id.
- `key`: unique human-readable key.
- `label`: display name.
- `description`: admin and browser summary text.
- `status`: `active`, `inactive`, or `archived`. Studio only shows active presets; delete archives instead of hard-deleting.
- `model_key`: primary model for editor defaults.
- `applies_to_models_json`: model scope. Today this must include supported Nano Banana models.
- `applies_to_task_modes_json` and `applies_to_input_patterns_json`: metadata used for compatibility and UI filtering.
- `prompt_template`: the template that is rendered into the final prompt.
- `input_schema_json`: structured text fields.
- `input_slots_json`: structured image slots.
- `thumbnail_path` and `thumbnail_url`: preset browser card artwork.
- `source_kind` and `base_builtin_key`: whether this is custom, imported, built in, or based on a built-in preset.
- `notes`, `version`, and `priority`: admin metadata.

API ownership:

- `apps/api/app/schemas.py`: `PresetUpsertRequest`, `PresetRecord`, and `ValidateRequest`.
- `apps/api/app/store_support.py`: table schema, additive columns, and seeded shared presets.
- `apps/api/app/service.py`: preset validation, rendering, submit persistence, and retry restore shaping.

Web ownership:

- `apps/web/components/media-preset-editor-screen.tsx`: create/edit UI.
- `apps/web/components/studio/studio-preset-browser.tsx`: Studio preset picker.
- `apps/web/hooks/studio/use-studio-composer.ts`: composer state for preset fields and image slots.
- `apps/web/app/api/control/media/shared.ts`: turns browser form data into API payloads.
- `apps/web/components/studio/studio-composer-restore.ts`: restores preset values and slot media for retry/revision.
- `apps/web/lib/preset-sharing.ts`: import/export bundle normalization.

## Placeholder Rules

Preset templates use two placeholder syntaxes.

Text placeholders:

```text
{{field_key}}
```

Image-slot placeholders:

```text
[[slot_key]]
```

Example:

```text
Create a premium selfie of [[person]] standing beside {{character_name}} from {{movie_name}}.
```

The API treats the prompt template as a contract:

- Every `{{field_key}}` token must have a matching item in `input_schema_json`.
- Every `[[slot_key]]` token must have a matching item in `input_slots_json`.
- Extra configured text fields or slots that are not used in the template are rejected.
- Duplicate text keys or slot keys are rejected.
- Required text fields must have a submitted value or a `default_value`.
- Required image slots must receive at least one image reference.

This strict matching is deliberate. It keeps admin setup, Studio rendering, API validation, and retry/revision restore aligned.

## Text Fields

Text fields are stored in `input_schema_json`.

Current field shape:

```json
{
  "key": "character_name",
  "label": "Character",
  "placeholder": "John Wick",
  "default_value": "",
  "required": true
}
```

How text fields work:

- The editor creates fields in the `Preset create/edit` page.
- Studio renders one input per configured field when the preset is selected.
- The browser submits values as `preset_inputs_json`.
- The web API normalizes that into `preset_text_values`.
- The API renders each `{{key}}` token with the submitted value.
- If a value is empty, the API falls back to `default_value`.
- If the field is required and both submitted value and default are empty, validation fails.

Legacy compatibility:

- The API still accepts `preset_inputs_json` and normalizes it into `preset_text_values`.

## Image Slots

Image slots are stored in `input_slots_json`.

Current slot shape:

```json
{
  "key": "person",
  "label": "Portrait",
  "help_text": "Upload the portrait that should appear in the result.",
  "required": true,
  "max_files": 1
}
```

How image slots work:

- The editor creates named image requirements in the `Preset create/edit` page.
- Studio renders one upload/drop tile per image slot.
- A slot can be filled from upload, reference library, or gallery asset selection.
- The browser submits slot state through:
  - `preset_slot_file:{slot_key}` for uploaded files
  - `preset_slot_asset:{slot_key}` for selected gallery assets
  - `preset_slot_values_json` for existing reference-library ids
- The web API normalizes these into `preset_image_slots`.
- Uploaded slot files are registered into the reference media store before submission.
- Reference-library ids are resolved to stored paths.
- Gallery asset ids are preserved for API-side resolution.

When the API renders the prompt, filled image slots become numbered image reference tokens:

```text
[[person]] -> [image reference 1]
```

If multiple slots are filled, numbering follows the order of `input_slots_json`:

```text
[[first]] [[second]] -> [image reference 1] [image reference 2]
```

If an optional image slot is not filled, its raw token remains in the final prompt:

```text
[[optional_background]]
```

That makes optional missing slots visible instead of silently inventing media.

## Runtime Flow

1. Admin creates or edits a preset.
2. The editor sends the preset record to `/media/presets`.
3. The API validates placeholder keys against configured text fields and image slots.
4. Studio loads active, non-archived presets and filters them to the selected Nano model.
5. User selects a preset in Studio.
6. Studio switches into the structured preset composer path.
7. Text fields and image slots render above the normal prompt flow.
8. Validation submits `preset_id`, `preset_text_values`, and `preset_image_slots`.
9. The API resolves the preset, fills text placeholders, converts slot media into image reference tokens, and merges slot images into the model request.
10. Submit persists the batch/job with:
    - requested and resolved preset key
    - preset source
    - resolved prompt
    - preset text values
    - preset image slots
    - normalized request data
11. Completed assets keep preset metadata for the inspector.
12. Retry and Create Revision use the saved request summary and normalized request data to restore the preset, text values, and image-slot media.

## Built-In, Custom, And Imported Presets

Seeded shared presets are created during database initialization if they are missing. Current examples include:

- `3d-caricature-style-nano-banana`
- `selfie-with-movie-character-nano-banana`

Preset source behavior:

- `custom`: created locally in the admin UI.
- `builtin`: shipped/shared preset identity.
- `built_in_override`: local override of a built-in style preset.
- `imported`: imported from a portable preset bundle.

Import/export behavior:

- Export creates a portable preset bundle with manifest data and optional thumbnail asset.
- Import normalizes the preset payload, stores imported thumbnails, skips exact custom duplicates, and imports shipped shared presets as local copies.

## Inspector And Revision Behavior

Completed preset-backed assets show preset details in the selected-asset inspector.

The inspector distinguishes preset slot media from normal source/reference media. If a preset slot already explains the source image, the generic source preview is hidden so the same image does not appear twice.

Create Revision behavior:

- restores the preset selection
- restores text field values from stored request metadata
- restores slot media from saved preset slot values
- keeps media restore failures non-blocking when possible, so the user can still revise the prompt and refill missing media

Retry behavior:

- rebuilds the submit request from stored normalized request data
- reattaches preset text values and image slots
- strips duplicated source/preset media from generic image lists before replay

## Current Limitations

- Structured presets are currently image-slot focused.
- `max_files` is stored, but the current editor writes `1` and the Studio slot UI behaves as one image per slot.
- `system_prompt_template` is stored and preserved in sharing payloads, but the current editor sends it as empty/null and runtime rendering is driven by `prompt_template` plus selected system prompt ids.
- Presets are currently scoped to supported Nano Banana models. Non-Nano model input structure should continue to use the standard composer slot contract until a later unified contract migration.

## Verification

Committed coverage exists in:

- `apps/api/tests/test_api_smoke.py`
  - create/list preset
  - seeded shared Nano presets
  - preset model scope rejection
  - legacy web field names
  - structured preset image reference numbering
  - archive-on-delete behavior
  - retry restore shape
- `apps/web/lib/media-payload.test.ts`
  - preset slot uploads
  - reference-library slot resolution
  - gallery asset slot preservation
- `apps/web/lib/media-studio-helpers.test.ts`
  - structured prompt preview placeholder rendering
  - inspector reference de-duplication
- `apps/web/lib/preset-sharing.test.ts`
  - portable preset bundle creation/import normalization

Useful gates after changing preset behavior:

```bash
npm --workspace apps/web run test -- media-payload.test.ts media-studio-helpers.test.ts preset-sharing.test.ts
python -m pytest apps/api/tests/test_api_smoke.py -k "preset or retry"
```
