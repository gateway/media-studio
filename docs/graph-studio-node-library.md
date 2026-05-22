# Graph Studio Node Library

Graph Studio nodes are backend-owned definitions. The frontend renders fields, ports, limits, previews, and execution state from those definitions.

For implementation work, use `docs/graph-studio-node-authoring.md` as the node-authoring contract. This library document describes the current node catalog; the authoring guide describes how to add or change nodes safely.

## Definition Contract

Every node definition should include:

- `type`: stable identifier such as `image.transform`
- `title`, `description`, `category`, `tags`, `search_aliases`
- optional short `help_text` for node-level help popovers when the longer description is not enough
- `source`: `system`, `kie_model`, `external_llm`, `preset`, or future plugin metadata
- `execution`: executor id, mode, cacheability, output-node status, retryability
- `limits`: max dimensions, duration, frames, bytes, array size, or text length
- `ui.default_size`, `ui.min_size`, `ui.max_size`: node sizing constraints used by the frontend resize frame
- `ui.color`, `ui.accent`, `ui.icon`: visual tokens used by node headers, borders, handles, and search results
- `ui.preview`: whether the generic renderer should reserve preview space
- `ui.field_layout`: standard field layout hint, currently `stack`
- `ports.inputs` and `ports.outputs`: typed graph connections
- `fields`: editable controls rendered by the generic node renderer

Pricing is also backend-owned. Graph-level estimates come from `POST /media/graph/estimate`; the frontend renders returned summaries and warnings but does not duplicate model-specific pricing math.

The API validates shipped node definitions before returning them. Unknown visible field renderers, unknown port types, missing layout constraints, invalid cardinality, and unknown color/icon tokens are treated as definition errors.

Supported port value types:

- `image`
- `video`
- `audio`
- `text`
- `json`
- `asset`
- `reference_media`
- `job`
- `any`

Do not add tensor or latent types unless Media Studio adds local ML execution.

## Implemented Nodes

### `prompt.text`

- Category: Prompt
- Inputs: optional `text`
- Fields: `mode`, `text`
- Outputs: `text`
- Purpose: reusable prompt text that can feed one or more model prompt fields, or pass through connected LLM/text output.
- Modes: `replace` passes connected text through, `append` adds typed text after connected text, and `prepend` adds typed text before connected text.
- Limits: max text length should stay bounded.

### `prompt.llm`

- Category: Prompt
- Inputs: optional `user_prompt` text, optional `image`
- Fields: `mode`, `provider`, `model_id`, `model_supports_images`, `system_prompt`, `user_prompt`, `image_instruction`, `temperature`, `max_tokens`
- Outputs: generated `text`, advanced `metadata`
- Purpose: use a saved Studio enhancement provider, OpenRouter model id, or local OpenAI-compatible model id to generate final prompt text from text and optional image context.
- Prompt placeholders: `system_prompt` supports `[user_prompt]` and `{user_prompt}`. When no placeholder is present, the user text is sent as the user message.
- Provider guardrails: workflow JSON stores provider/model ids only. API keys remain in Settings/env. Image input requires a provider/model marked as image-capable.
- Pricing: external LLM token pricing is currently reported as unknown in `POST /media/graph/estimate`, so Run confirmation is required when this node is enabled.

### `prompt.recipe`

- Library node: `prompt.recipe`
- Inputs:
  - optional `user_prompt`, `source_prompt`, `previous_output`, and ordered `image_refs`
- Fields:
  - `recipe_category`, `recipe_id`, provider/model/runtime overrides, `external_variables_json`
  - after recipe selection, the generic renderer exposes the selected recipe's enabled variables and custom fields with recipe-specific labels, placeholders, and helper text
- Outputs:
  - `text`: the primary prompt or analysis text
  - `result`: canonical normalized recipe result JSON
- Purpose: execute saved Prompt Recipes inside Graph Studio through the shared external-LLM backend path without creating a second frontend-owned recipe contract.
- UX contract:
  - users pick a category first when needed, then select a Prompt Recipe from the filtered list
  - the node help and inline field notes come from the selected backend-owned recipe metadata
  - recipe-specific compatibility node definitions are no longer emitted into the live node catalog; older workflow payloads are normalized to the generic node on backend read
- Image modes:
  - `none`
  - `direct_reference`
  - `analyze_then_inject`
  - `both`
- Validation:
  - archived/inactive recipe references fail clearly
  - unresolved template variables fail before execution
  - connected image count must stay within the recipe `max_files`
  - direct image modes require an image-capable provider/model
- Pricing: treated as external LLM spend. Estimates stay explicit about unknown pricing and never silently become zero.
- Result contract:
  - `recipe_id`
  - `recipe_key`
  - `category`
  - `output_format`
  - `raw_text`
  - `parsed_json`
  - `final_text`
  - `prompts`
  - `warnings`
  - `provider_kind`
  - `provider_model_id`

### `prompt.parse`

- Category: Prompt
- Inputs: `result` as one canonical Prompt Recipe result payload
- Outputs: `prompt_1` through `prompt_12`, plus pass-through `result`
- Purpose: fan out normalized multi-prompt Prompt Recipe output into fixed downstream prompt ports.
- Supported upstream formats: `single_prompt`, `prompt_list`, `json_prompt_batch`, `image_analysis`, and `structured_shot_sequence` after they have been normalized by `prompt.recipe`.
- Guardrail: this node only depends on the canonical Prompt Recipe result contract. It is not a generic arbitrary-JSON parser.

### `prompt.concat`

- Inputs: `text_a`, `text_b`
- Fields: `inline_text`, `separator`
- Outputs: `text`
- Purpose: merge multiple prompt streams into one model prompt input.

### `media.load_image`

- Category: Media
- Inputs: none
- Fields: `asset_id`, `reference_id`
- Outputs: `image`
- Purpose: load an existing Media Studio asset or reference image.
- UI: image preview, replace/remove, library picker, drag/drop.
- Guardrail: exactly one image source when a downstream required input depends on it; optional empty image is allowed for models with optional refs.

### Generated KIE Model Nodes

- Category: `Models/Image`, `Models/Video`, or `Models/Audio`
- Inputs: generated from supported KIE input metadata, including `prompt`, `image_refs`, `video_refs`, and `audio_refs`
- Fields: prompt plus KIE-generated options
- Outputs: generated media output (`image`, `video`, or `audio`) plus advanced `job`
- Purpose: submit model jobs through existing Media Studio/KIE validation, pricing, submit, polling, and asset paths.
- Guardrail: no direct frontend KIE calls.
- Pricing: model headers show the current server estimate; missing or stale pricing appears as a warning and never silently becomes zero.
- Help: generated model nodes render compact definition-driven help from `source`, `limits`, typed ports, and visible field options. The help should include input media caps, required inputs, output type/count, key settings such as aspect ratio/resolution/duration/sound, and the cost-estimate caveat. Do not hand-code provider-specific help in the frontend.
- Compatibility: `model.kie.nano_banana_pro` is preserved for existing workflows; additional supported models use `model.kie.<model-key>`.

### `media.save_image`

- Category: Media
- Inputs: `image` as one image or `image[]` up to 25 items.
- Fields: hidden label for now
- Outputs: `asset` as one or many saved gallery asset refs, plus pass-through `image` asset refs.
- Purpose: expose a graph image result as a normal Media Studio asset/output.
- Behavior: reference-media inputs are promoted into `graph-derived` gallery assets; existing asset inputs can be assigned to a group. If multiple images are connected, each input becomes its own gallery asset and `saved_asset_count` records the total.

### `media.save_images`

- Category: Media
- Inputs: `images` as `image[]`
- Fields: optional group/project, hidden label, naming pattern.
- Outputs: `assets` as `asset[]`, `images` as pass-through asset refs.
- Purpose: promote derived image arrays, such as grid slices, into normal Media Studio gallery assets.
- Behavior: retained as the explicit batch save node, but standard `media.save_image` also accepts image arrays. Does not auto-save the original source image; wire the original to another save node if the workflow should retain original plus slices.

### `media.load_video`

- Category: Media
- Inputs: none
- Fields: `asset_id`, `reference_id`
- Outputs: `video`
- Purpose: load an existing Media Studio video asset or reference video.
- Guardrails: validates kind before execution and keeps references data-root owned.

### `media.save_video`

- Category: Media
- Inputs: required `video`, optional `audio`
- Fields: optional group/project, `filename_prefix`, `format`, `codec`, `crf`, audio policy/fit controls, volume/offset controls, `include_metadata`, hidden label.
- Outputs: `asset`, `video`.
- Purpose: expose a graph video output as a normal Media Studio video asset/output.
- Format presets:
  - `source_original`
  - `mp4_h264_browser`
  - `mp4_h265`
  - `webm_vp9`
- Current behavior: `source_original` preserves generated video assets without extra work. Non-original presets run a bounded ffmpeg transcode for generated video assets and reference-media video inputs, import the transcoded result as graph/reference media, then promote it into a normal Media Studio gallery video asset with graph lineage.
- Audio behavior: with a connected audio input, `media.save_video` can replace, mix, or mute the saved video's audio. Muxed outputs are written as derived reference videos first, then promoted into gallery assets. Lineage records source video/audio ids, policy, fit, offset, and volume settings.
- Audio guardrails: max 100 MB audio input, max 10 minutes, data-root paths only, ffmpeg/ffprobe required, no shell execution.

### `media.load_audio` / `media.save_audio`

- Use the same reference/asset/output policies as image/video.
- `media.load_audio` imports/stages wav, mp3, m4a, and aac reference audio.
- `media.save_audio` supports `source_original`, `mp3`, `wav`, and `m4a_aac` output formats.
- Saved audio becomes a normal gallery asset with `generation_kind = "audio"` and graph lineage.
- Audio metadata includes duration, codec, sample rate, channels, bitrate, container/format name, and file size when ffprobe is available.
- Keep audio extraction and conversion bounded by 100 MB, 10 minutes, and data-root file paths.

### `preview.image`, `preview.video`, `preview.audio`

- Show intermediate graph outputs without necessarily registering gallery assets.
- Currently pass through the first connected media ref and record preview metrics.

### `display.any`

- Category: Preview
- Inputs: `value` as one `any` input.
- Outputs: pass-through `value`, plus `json` inspection payload.
- Purpose: user-facing display node for mixed graph output. It can show text, JSON, image/video/audio refs, assets, jobs, and other values without saving a gallery asset.
- Behavior: media refs resolve through the normal asset/reference preview hydration path; non-media values render as formatted text/JSON. The node is terminal-friendly but can also pass values through to another node.
- Cardinality: this is intentionally single-input. Use `debug.inspect` when a multi-input inspection node is needed.

### `debug.inspect`, `debug.metadata`

- Show structured refs, dimensions, duration, bytes, mime type, model/job ids, and warnings.
- Must not expose filesystem paths or secrets to the browser.

### Image Utility Nodes

- Implemented: `image.transform`, `image.grid_slice`, `image.split`
- Inputs: `image`
- Fields: `operation`, dimensions, crop origin, canvas color, fit, and output format.
- Operations: `resize`, `crop`, `pad`, `convert_format`, `extract_metadata`.
- Outputs: `image` for media transforms; `metadata` as `json` for metadata extraction.
- Guardrails: Pillow only, max dimension 4096, data-root output only, stores transformed media as reference media.
- Catalog rule: older granular utility node types are hidden from node search/add menus. Legacy executors remain internally available so older saved workflows can still run until migrated.

### `image.grid_slice`

- Inputs: one `image`
- Fields: rows, columns, gutter mode, gutter px, trim outer gutter, output format.
- Outputs: `images` as `image[]`, `metadata` as `json`.
- Purpose: split generated grid outputs into separate reusable reference images.
- Guardrails: max 25 cells, max 4096px source dimension, Pillow only.
- Lineage: every slice records parent media, crop rectangle, row/column, and transform params as graph artifact metadata.

### `image.split`

- Inputs: `images` as `image[]`
- Fields: output count, 1-25.
- Outputs: numbered image ports, `image_1` through `image_25`, with the UI showing only the requested count.
- Purpose: fan out an ordered image array so each slice can feed a different downstream branch, prompt, or model node.
- Behavior: pass-through only; it does not create new media files. It preserves the ordered reference media ids and records split lineage artifacts for inspection.
- Guardrails: fails clearly when the requested output count is higher than the received image count.

## Selective Execution

Node execution mode is stored in workflow node metadata as `metadata.execution.mode`.

- `enabled`: runs normally.
- User-facing `Muted` writes internal mode `frozen`: reuses a pinned `cached_run_id`/`cached_artifact_ids` when present, otherwise the latest completed output for the same saved workflow/node id, and does not call the executor.
- `bypassed`: advanced utility-only mode; supported utility nodes pass compatible input through without producing a new derived artifact.
- Legacy/internal `muted` is shown as `Disabled`: skips the node and produces no output; downstream required inputs fail validation clearly.

Pinned cached outputs are stored under `metadata.execution.cached_run_id` and `metadata.execution.cached_artifact_ids`. Validation blocks the run if the pinned run output, artifact rows, asset ids, or reference media ids no longer exist.

Current bypass support is intentionally narrow: image utility pass-through nodes declare `execution.bypass_mode` in their backend node definition.

### `preset.render` And Dynamic Preset Nodes

- Generic node: `preset.render`
- Dynamic nodes: `preset.render.<preset-key>`
- Inputs: generic `image_refs` for the generic node; one generated image input per preset slot for dynamic nodes.
- Fields: preset picker/JSON fields for the generic node; generated text and choice fields for dynamic nodes.
- Outputs: `prompt`, `image_refs`, `preset`, `recommended_models`.
- Purpose: render existing Media Studio structured presets into graph values without duplicating the preset system.
- Current limit: richer preset-specific layout/help remains a follow-up.

## Video Utility Nodes

- Implemented: `video.transform`, `video.combine`, `video.extract`
- Inputs: `video`
- `video.transform` operations: `resize`, `trim`, `convert_container`; output is `video` plus `metadata`.
- `video.combine` combines ordered numbered clip slots into one derived reference video; output is `video` plus `metadata`.
- `video.extract` operations: `poster_frame`, `extract_frames`, `extract_audio`, `extract_metadata`; outputs are `image`, `images`, `audio`, or `metadata` based on the selected operation.
- Use ffmpeg subprocess with `shell=False`.
- Fail clearly if ffmpeg is unavailable.
- Enforce max frames, max duration, max output bytes, and data-root path restrictions.
- Catalog rule: older granular video utility node types are hidden from node search/add menus. Legacy executors remain internally available for saved workflow compatibility.

### `audio.transform`

- Inputs: `audio`
- Fields: `operation`, `start_seconds`, `duration_seconds`, `format`, `target_lufs`
- Operations: `trim`, `convert_format`, `normalize`, `extract_metadata`
- Outputs: `audio` for media transforms; `metadata` as `json` for metadata extraction.
- Purpose: one consolidated audio utility node instead of separate trim/convert/normalize nodes.
- Guardrails: ffmpeg/ffprobe with `shell=False`, max 100 MB, max 10 minutes, data-root output only, transformed media remains reference media until connected to `media.save_audio`.

### `video.combine`

- Inputs: `video_1` through `video_12`; `clip_count` controls how many ordered input slots are visible and required. The advanced `audio` input is reserved for a later audio-mix pass.
- Fields: `clip_count`, `transition`, `transition_duration_seconds`, `resolution_policy`, `width`, `height`, `fps_policy`, `output_format`, `quality_crf`, `title`.
- Transitions: `hard_cut`, `crossfade`, `fade_to_black`.
- Outputs: combined `video` reference media and `metadata`.
- Purpose: combine multiple generated clips, such as four Kling branch outputs, into one previewable derived video before connecting to `media.save_video`.
- Gallery rule: this node does not create gallery assets directly; connect it to `media.save_video` to promote the combined reference video.
- Lineage: metadata records ordered source clip ids/artifact ids, transition settings, output format, resolution, fps, and duration.
- Guardrails: max 12 clips, max 10 minutes total input duration, max 500 MB per source, ffmpeg/ffprobe required, no external audio mixing in v1.

## Video Model QA Notes

Generated KIE video model nodes infer output type from task mode/provider hints before `media_types`. This is required because live KIE metadata can describe an image-to-video model such as `kling-2.6-i2v` with `media_types: ["image"]` even though its task mode is `image_to_video`.

Expected `model.kie.kling_2_6_i2v` contract:

- Category: `Models/Video`
- Inputs: `prompt`, one required `image_refs`
- Fields: prompt, `duration` with `5`/`10`, `sound`
- Outputs: `video`, advanced `job`
- Help example: "Video model for image to video. Inputs: prompt, exactly 1 image. Outputs: 1 video. Settings: Sound on/off. Duration 5s or 10s. Cost: estimated before Run from current settings."

Expected `model.kie.kling_3_0_i2v` contract:

- Category: `Models/Video`
- Inputs: `prompt`, required `start_frame`, optional `end_frame`
- Fields: prompt, `mode`, `sound`, `duration` from 3 through 15, `aspect_ratio`, `multi_shots`
- Outputs: `video`, advanced `job`

Seedance 2.0 exposes explicit `start_frame` and `end_frame` ports plus separate `reference_images`, `reference_videos`, and `reference_audios` ports. These represent mutually exclusive scenarios: text-to-video with no media, image-to-video with Start/End Frames, or multimodal reference-to-video with reference media. Graph validation must reject workflows that mix Start/End Frames with reference images, videos, or audio.

Expected `model.kie.nano_banana_pro` help behavior:

- Summary: image model for text-to-image or image-edit.
- Inputs: prompt plus up to 8 reference images.
- Outputs: 1 image.
- Settings: aspect ratio options, resolution options, and output format options.
- Cost: estimated before Run from current settings.

## Prompt Authoring Direction

- Reusable prompt logic now lives primarily in:
  - `prompt.text`
  - `prompt.llm`
  - `prompt.recipe`
  - `prompt.parse`
- Future prompt authoring additions should extend the backend-owned Prompt Recipe or LLM paths unless there is a clear runtime need for a new first-class node type.

## Workflow Sharing

- Structure export: `.media-studio-graph.json`
- Bundle export: `.media-studio-graph.zip`
- JSON exports preserve nodes, edges, fields, positions, sizes, collapsed state, custom title, color metadata, and node definition fingerprints where available.
- Bundle exports include referenced reference media files and remap them on import through the existing reference-media import path.
- Exports strip API-key-like fields, data URLs, and absolute local paths.

## Workflow Organization Systems

### Groups

- Stored in workflow metadata as `metadata.groups`.
- Group records contain id, title, color, member node ids, computed bounds, and optional execution mode.
- Group execution actions apply the selected mode to member nodes; runtime behavior remains node-owned through each node's `metadata.execution.mode`.
- Group frames are draggable containers: dragging the colored frame/title moves all member nodes and persists the updated group bounds.
- Copy/paste preserves a group only when all member nodes are copied together.

### Run History And Artifacts

- Workflow-scoped runs are available through `GET /media/graph/workflows/{workflow_id}/runs`.
- Run history shows status, duration, node count, artifact count, and errors.
- Artifact inspection uses the existing run artifact endpoint and preserves graph lineage terminology: artifact, reference media, asset, parent, transform.
- Restore loads the stored run workflow snapshot and node output snapshots without rerunning the graph.

### Templates And Tabs

- Templates use the existing graph template API and instantiate as editable workflows.
- The tab foundation stores open workflow session state in browser storage only.
- Tabs preserve workflow identity, current workflow JSON, run id, dirty marker, and updated timestamp; saved workflows remain database-backed.
