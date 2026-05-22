# Media Studio Preset System

This document describes the current Media Studio preset system used by the gallery/composer flow. It does not cover Graph Studio node workflows except where the same preset records are reused by other parts of the application.

## What Presets Are

Presets are reusable Studio generation recipes. A preset packages a prompt template, optional text inputs, optional image slots, thumbnail metadata, and model availability into a saved record that operators can select in the Studio composer.

The main preset flow is:

1. An admin creates or edits a preset in `/presets`.
2. The preset is stored in the API database.
3. Studio loads active presets and filters them to compatible models.
4. A user selects a preset in the gallery/composer UI.
5. Studio renders structured text fields and image slots.
6. The backend validates the selected preset, resolves placeholder values, resolves image references, and submits the final generation request.
7. Generated jobs/assets store preset lineage so the gallery can show what preset was used and support retry/restore.

## Placeholder Model

Preset prompt templates use two placeholder styles:

- `{{field_key}}` for text values.
- `[[image_slot_key]]` for image references.

Example:

```text
Create a premium selfie of [[person]] standing beside {{character_name}} from {{movie_name}}.
```

In this example:

- `person` must be configured as an image slot.
- `character_name` and `movie_name` must be configured as text fields.

The editor blocks saving if:

- a prompt references a text placeholder that has no text field,
- a prompt references an image placeholder that has no image slot,
- a configured text field is not used in the prompt,
- a configured image slot is not used in the prompt,
- duplicate field or slot keys exist,
- required labels/keys are missing.

## Preset Admin UI

The preset admin lives at:

- `apps/web/app/presets/page.tsx`
- `apps/web/app/presets/new/page.tsx`
- `apps/web/app/presets/[presetId]/page.tsx`
- `apps/web/components/media-models-console.tsx`
- `apps/web/components/media-preset-editor-screen.tsx`

The `/presets` page shows structured presets in a list. Each preset can be expanded to inspect:

- preset key,
- status,
- available models,
- text field count,
- image slot count,
- field placeholder tokens,
- image slot placeholder tokens,
- prompt template,
- thumbnail.

The editor supports:

- preset name,
- description,
- thumbnail upload/removal,
- enabled/disabled status,
- model availability toggles,
- prompt template,
- text fields,
- image slots,
- notes,
- create/save,
- archive,
- export.

Import/export is handled as ZIP bundles with a `manifest.json` and optional thumbnail asset.

The `/presets` page now has two tabs:

- `Media Presets`: the existing Studio generation preset system backed by `media_presets`.
- `Prompt Recipes`: a separate LLM prompt-template library backed by `prompt_recipes`.

These systems intentionally stay separate. Prompt Recipes are saved director templates for future graph-node ingestion; they do not run LLM jobs or change Studio composer preset behavior in this slice.

## Preset Fields

Text fields are stored in `input_schema_json`.

Current text field properties:

- `key`
- `label`
- `placeholder`
- `default_value`
- `required`

The current editor presents text fields as single-line inputs in the Studio composer.

Image slots are stored in `input_slots_json`.

Current image slot properties:

- `key`
- `label`
- `help_text`
- `required`
- `max_files`

Important current limitation: the editor shows a `maxFiles` control, but the save path currently writes `max_files: 1`. Treat image slots as single-image slots until that is explicitly expanded and tested.

## Database Storage

Preset records are stored in the API SQLite database table:

```text
media_presets
```

The table is created and maintained in:

- `apps/api/app/store_support.py`

The main store helpers are in:

- `apps/api/app/store.py`

Key store functions:

- `list_presets()`
- `get_preset(preset_id)`
- `get_preset_by_key(key)`
- `create_or_update_preset(payload)`
- `delete_preset(preset_id)`

`delete_preset()` archives the preset by setting `status = "archived"`; it does not hard-delete the row.

## Preset Record Shape

The backend request/response models are:

- `PresetUpsertRequest` in `apps/api/app/schemas.py`
- `PresetRecord` in `apps/api/app/schemas.py`

The frontend type is:

- `MediaPreset` in `apps/web/lib/types.ts`

Important stored fields:

- `preset_id`: stable primary key.
- `key`: unique human-readable key.
- `label`: display name.
- `description`: short user-facing explanation.
- `status`: usually `active`, `inactive`, or `archived`.
- `model_key`: primary/default model key.
- `source_kind`: `custom`, `imported`, `builtin`, or `built_in_override`.
- `base_builtin_key`: optional reference to a built-in preset base.
- `applies_to_models_json`: model keys this preset can be used with.
- `applies_to_task_modes_json`: stored scope metadata, currently lightly used.
- `applies_to_input_patterns_json`: stored scope metadata, currently lightly used.
- `prompt_template`: the template containing `{{field}}` and `[[slot]]` tokens.
- `system_prompt_template`: stored but not actively exposed in the current preset editor.
- `system_prompt_ids_json`: stored but not actively exposed in the current preset editor.
- `default_options_json`: model option defaults applied when a preset is selected.
- `rules_json`: stored rule metadata.
- `requires_image`, `requires_video`, `requires_audio`: capability flags.
- `input_schema_json`: text field definitions.
- `input_slots_json`: image slot definitions.
- `choice_groups_json`: stored choice metadata; not actively exposed in the current preset editor.
- `thumbnail_path`, `thumbnail_url`: preset thumbnail metadata.
- `notes`: internal/admin notes.
- `version`: preset schema/version label.
- `priority`: ordering weight.

## API Routes

Backend FastAPI routes:

- `GET /media/presets`
- `GET /media/presets/{preset_id}`
- `POST /media/presets`
- `PATCH /media/presets/{preset_id}`
- `DELETE /media/presets/{preset_id}`

These routes are defined in:

- `apps/api/app/main.py`

Frontend control routes:

- `POST /api/control/media-presets`
- `PATCH /api/control/media-presets/{presetId}`
- `DELETE /api/control/media-presets/{presetId}`
- `POST /api/control/media-presets/import`
- `GET /api/control/media-presets/export/{presetId}`
- `POST /api/control/media-preset-thumbnail`
- `GET /api/preset-thumbnails/{path}`

## Model Availability

Preset model availability is stored on the preset in `applies_to_models_json`.

In the editor, the "Available in" section shows compatible image models as toggles. The compatible model list is derived from the current model metadata and whether the preset requires image input.

Compatibility rules currently focus on image generation/image edit models:

- Prompt-only presets can apply to compatible text-to-image/image-generation models.
- Image-slot presets require models that accept image inputs.
- Video/audio-input models are filtered out of the current structured preset path.
- Hidden or unsupported Studio models are not offered.

Relevant helpers:

- `compatibleStructuredImagePresetModels()`
- `modelSupportsStructuredImagePreset()`
- `studioPresetSupportedModels()`
- `resolveStudioPresetTargetModel()`

These live in:

- `apps/web/lib/media-studio-helpers.ts`

The backend also validates model compatibility before saving or resolving a preset:

- `validate_preset_payload()`
- `_model_key_supports_structured_preset()`
- `_compatible_preset_model_keys()`

These live in:

- `apps/api/app/service.py`

## Studio Composer Runtime

The Studio composer is the main place users consume presets.

Relevant files:

- `apps/web/components/media-studio.tsx`
- `apps/web/components/studio/studio-preset-browser.tsx`
- `apps/web/hooks/studio/use-studio-composer.ts`
- `apps/web/lib/media-studio-helpers.ts`
- `apps/web/app/api/control/media/shared.ts`

When a preset is selected:

1. Studio finds the preset by `preset_id` or `key`.
2. Studio chooses a compatible target model.
3. If the preset has structured fields or image slots, Studio switches from the freeform prompt box to structured preset UI.
4. Existing normal attachments/source images are cleared for structured presets.
5. Text fields are shown from `input_schema_json`.
6. Image slots are shown from `input_slots_json`.
7. Default model options from `default_options_json` are merged into the composer options.
8. Studio creates a client-side preview of the final prompt.

On submit:

1. The browser sends the selected preset id, text values, and image slot values/files/assets.
2. The web control route converts uploaded slot files into reference media records.
3. The API reloads the preset from the database.
4. The API validates required text fields and image slots.
5. The API renders the final prompt server-side.
6. The API resolves image slot references into model input images.
7. The request is validated, priced, and submitted.

The server-side render path is canonical. The client preview is for user feedback only.

## Gallery Lineage And Retry

When a preset-backed job is submitted, the system stores preset metadata on batches/jobs/assets.

Stored lineage includes:

- requested preset key,
- resolved preset key,
- preset source,
- final prompt used,
- preset text values,
- preset image slot values,
- selected system prompts,
- normalized request JSON.

This lets the gallery show preset details for generated assets and lets retry/restore workflows rebuild the composer with the original preset values.

Relevant backend storage columns are in:

- `media_batches`
- `media_jobs`
- `media_assets`

These are defined in:

- `apps/api/app/store_support.py`

Retry helpers are in:

- `apps/api/app/service.py`
- `apps/web/components/studio/studio-composer-restore.ts`
- `apps/web/lib/media-studio-helpers.ts`

## Default Presets

The app seeds several shared default presets during database bootstrap.

Seed logic:

- `apps/api/app/store_support.py`

Seeded presets currently include:

- `2x2-pose-grid`
- `3d-caricature-style-nano-banana`
- `exploding-food`
- `food-recipe-infographic`
- `giant-animal-anywhere`
- `photo-restoration`
- `selfie-with-movie-character-nano-banana`

Seed thumbnails live in:

- `apps/api/app/seed_assets/preset-thumbnails`

Runtime uploaded thumbnails live in:

- `data/preset-thumbnails`

## Import And Export

Preset bundles are ZIP files.

Bundle shape:

- `manifest.json`
- optional thumbnail file under `assets/`

Bundle helpers:

- `apps/web/lib/preset-sharing.ts`

Import behavior:

- Exact duplicate custom presets are skipped.
- Same-key conflicts are imported as copies.
- Shared/built-in-style presets are imported as local copies instead of being skipped.

Export behavior:

- Reads the current preset.
- Adds thumbnail bytes when available.
- Writes a portable manifest.
- Downloads a ZIP file.

## Adding Or Updating A Preset

To add a preset through the UI:

1. Go to `/presets/new`.
2. Enter a preset name and description.
3. Add text fields for each `{{field_key}}` placeholder.
4. Add image slots for each `[[image_slot_key]]` placeholder.
5. Write the prompt template using the exact field/slot keys.
6. Select which compatible models the preset should appear in.
7. Upload a thumbnail if desired.
8. Save.

To add or update seeded presets in code:

1. Update `_seed_default_presets()` in `apps/api/app/store_support.py`.
2. Add thumbnail assets under `apps/api/app/seed_assets/preset-thumbnails` if needed.
3. Keep `input_schema_json` and `input_slots_json` exactly aligned with prompt placeholders.
4. Set `applies_to_models_json` only to compatible models.
5. Add/update API tests for seeded defaults and model compatibility.

## Current Limits And Watchouts

- The current preset system is strongest for image generation and image edit flows.
- Video/audio flags exist in the schema, but the active preset composer path is not a production video/audio preset system yet.
- The editor does not expose every stored field. Be careful editing presets that rely on:
  - `system_prompt_template`,
  - `system_prompt_ids_json`,
  - `choice_groups_json`,
  - complex `default_options_json`,
  - `rules_json`.
- Image slot `max_files` should currently be treated as single-image in the editor path.
- Client-side prompt preview and server-side rendering should stay aligned, but the server is the final source of truth.
- Do not add frontend-only preset behavior without matching backend validation and runtime support.

## Testing Coverage

Relevant tests currently cover:

- preset create/list,
- model compatibility,
- seeded default presets,
- required image slot validation,
- validation/submit with preset text and image slots,
- preset slot files/assets/reference media mapping,
- prompt placeholder preview,
- import/export bundle handling,
- retry/restore of preset-backed jobs.

Main test files:

- `apps/api/tests/test_api_smoke.py`
- `apps/api/tests/test_validation_bundle_source_asset.py`
- `apps/web/lib/media-payload.test.ts`
- `apps/web/lib/media-studio-helpers.test.ts`
- `apps/web/lib/preset-sharing.test.ts`
- `apps/web/lib/media-presets-sharing-routes.test.ts`
- `apps/web/lib/preset-thumbnail-storage.test.ts`

## Prompt Recipes

Prompt Recipes live beside Media Presets but use their own persistence, schemas, routes, UI, thumbnails, and validation rules.

Prompt Recipes are reusable LLM instruction templates. A recipe can describe how to transform a user prompt, optional image analysis, source prompt context, and custom variables into a generation-ready prompt, JSON prompt batch, image analysis response, or structured shot sequence.

Prompt Recipes are stored in:

```text
prompt_recipes
```

Prompt Recipe drafting defaults are stored separately in:

```text
media_prompt_recipe_drafting_configs
```

The table is created and migrated in:

- `apps/api/app/store_support.py`

Primary backend helpers:

- `list_prompt_recipes(status=None, category=None)`
- `get_prompt_recipe(recipe_id)`
- `get_prompt_recipe_by_key(key)`
- `create_or_update_prompt_recipe(payload)`
- `delete_prompt_recipe(recipe_id)`

`delete_prompt_recipe()` archives by setting `status = "archived"`; it does not hard-delete records.

Backend schemas:

- `PromptRecipeUpsertRequest`
- `PromptRecipeRecord`
- `PromptRecipeDraftRequest`
- `PromptRecipeDraftResponse`
- `PromptRecipeDraftingConfigUpsertRequest`
- `PromptRecipeDraftingConfigRecord`
- `PromptRecipeVariable`
- `PromptRecipeCustomField`
- `PromptRecipeImageInputConfig`

Backend routes:

- `GET /prompt-recipes`
- `GET /prompt-recipes/{recipe_id}`
- `POST /prompt-recipes`
- `PATCH /prompt-recipes/{recipe_id}`
- `DELETE /prompt-recipes/{recipe_id}`
- `POST /prompt-recipes/draft`
- `GET /media/prompt-recipe-drafting-config`
- `PATCH /media/prompt-recipe-drafting-config`
- `POST /media/prompt-recipe-drafting-config/probe`

Frontend control routes:

- `GET /api/control/prompt-recipes`
- `POST /api/control/prompt-recipes`
- `POST /api/control/prompt-recipes/draft`
- `PATCH /api/control/prompt-recipes/{recipeId}`
- `DELETE /api/control/prompt-recipes/{recipeId}`
- `POST /api/control/prompt-recipes/import`
- `GET /api/control/prompt-recipes/export/{recipeId}`
- `POST /api/control/prompt-recipe-thumbnail`
- `GET /api/control/prompt-recipe-drafting-config`
- `PATCH /api/control/prompt-recipe-drafting-config`
- `POST /api/control/prompt-recipe-drafting-config/probe`
- `GET /api/prompt-recipe-thumbnails/{path}`

Prompt Recipe thumbnails are stored under:

- `data/prompt-recipe-thumbnails`

The admin UI lives in:

- `apps/web/app/presets/page.tsx`
- `apps/web/app/presets/prompt-recipes/new/page.tsx`
- `apps/web/app/presets/prompt-recipes/[recipeId]/page.tsx`
- `apps/web/app/settings/page.tsx`
- `apps/web/components/prompt-recipes/presets-tabs.tsx`
- `apps/web/components/prompt-recipes/prompt-recipes-list.tsx`
- `apps/web/components/prompt-recipes/prompt-recipe-editor-screen.tsx`
- `apps/web/components/prompt-recipes/prompt-recipe-drafting-settings-panel.tsx`

Prompt Recipes use `{{variable_key}}` tokens only. Unlike Media Presets, they do not require an exact match between every token and every configured input because future graph nodes may inject upstream values. Unknown valid variables are allowed by default when `rules_json.allow_external_variables` is true.

Required Prompt Recipe fields:

- `key`
- `label`
- `category`: `image`, `video`, `analysis`, or `utility`
- `status`: `active`, `inactive`, or `archived`
- `system_prompt_template`
- `output_format`: `single_prompt`, `prompt_list`, `json_prompt_batch`, `image_analysis`, or `structured_shot_sequence`
- `input_variables_json`
- `custom_fields_json`
- `image_input_json`

Validation blocks:

- missing label/key/template,
- invalid category/status/output format,
- duplicate recipe key,
- malformed `{{token}}` syntax,
- custom field keys that duplicate reserved variables,
- duplicate custom field keys,
- invalid custom field types,
- invalid image input mode,
- unknown variables when `allow_external_variables` is false.

Validation also stores non-blocking `validation_warnings_json` so the UI can show guidance without blocking flexible graph-ready recipes. Current warnings include:

- enabled variables that are not used in the template,
- disabled variables that are still referenced in the template,
- external variables that future graph nodes must provide,
- `image_analysis` used while image input is disabled,
- image input analysis enabled without an image analysis prompt,
- custom fields configured but not used in the template.

Seeded Prompt Recipes:

- `storyboard-director-3x3`
- `image-prompt-director`
- `video-director-multi-shot-json`
- `image-analysis-character-reference`
- `prompt-shortener`

Prompt Recipes are not yet consumed by Graph Studio nodes. The saved record shape is intentionally graph-ready so a future node can load a recipe by id/key and use `system_prompt_template`, `input_variables_json`, `custom_fields_json`, `image_input_json`, `output_format`, `output_contract_json`, `default_options_json`, and `rules_json`.

Prompt Recipes now include a server-backed Draft Assistant in the editor:

- the operator describes the recipe idea,
- the server resolves the configured Prompt Recipe drafting model,
- the backend calls the current OpenAI-compatible provider path,
- the provider returns JSON for a draft recipe,
- the backend normalizes and validates that draft through the normal Prompt Recipe validation pipeline,
- the editor is populated with the generated fields,
- the operator still reviews and clicks Save manually.

The Draft Assistant does not auto-save records and does not execute recipe runtime behavior. It is a creation helper only.

Drafting model defaults are configured in Settings beside the existing Prompt Enhancement controls. The drafting config stores provider/model/runtime defaults separately from `media_enhancement_configs`, while still reusing the current server-side provider access path and shared credentials where applicable.

Prompt Recipe bundles mirror Media Preset bundles at a separate contract boundary. Export downloads a ZIP with:

- `manifest.json`
- optional thumbnail file under `assets/`

The manifest kind is:

```text
media_studio_prompt_recipe_bundle
```

Import behavior:

- exact duplicate custom recipes are skipped,
- built-in/shared conflicts are imported as local copies,
- same-key conflicts are copied with a unique key/label,
- thumbnail assets are stored under `data/prompt-recipe-thumbnails`.

The editor exposes common structured controls for `default_options_json` and `rules_json`, including temperature, max output tokens, strict output, final-output-only, markdown, JSON, JSON validation, and external variables. Raw JSON remains visible as the advanced source of truth.
