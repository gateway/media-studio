# Graph Studio Implementation Log

Use this log to keep Graph Studio implementation notes durable. Every production slice should add a short entry with the behavior changed, what failed, what was verified, and what still needs attention.

## 2026-05-17 — Graph Cleanup Pass: Prompt Recipe Metadata, Registry/Validator Split, Dialog CSS Split

Changed behavior:

- Split the old `styles/dialogs-history.css` surface into smaller graph dialog files:
  - `styles/dialogs-shells.css`
  - `styles/dialogs-library.css`
  - `styles/history-preview.css`
- Extracted shared prompt-provider/runtime field factories into `apps/api/app/graph/prompt_node_fields.py` so prompt nodes and legacy Prompt Recipe compatibility nodes stop duplicating provider/runtime field definitions.
- Extracted legacy Prompt Recipe compatibility node generation into `apps/api/app/graph/prompt_recipe_legacy_nodes.py`, reducing `registry.py` back toward a generator/orchestrator role.
- Extracted Prompt Recipe-specific validation into `apps/api/app/graph/validator_prompt_recipe.py`, reducing inline recipe parsing and template-resolution logic inside `validator.py`.
- Moved more Prompt Recipe display metadata backend-side through `prompt_recipe_catalog.py`:
  - picker label with category
  - selection summary
  - field display placeholder/help text
- Simplified the frontend Prompt Recipe helper so it consumes backend-provided recipe summary/help metadata instead of rebuilding those strings locally.

Verification:

- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py apps/api/tests/test_api_smoke.py -q`
- `npm --workspace apps/web run test`
- `npm run typecheck:web`
- `npm run lint:web`
- `git diff --check`
- Local Codex browser verification on `/graph-studio` after reload:
  - prompt library still shows only the five visible prompt nodes
  - generic `Prompt Recipe` still filters by category and shows recipe-specific inline summary/help

Remaining risks:

- `registry.py` and `validator.py` are smaller and cleaner, but the next real backend cleanup after this is preset-specific extraction if the Preset surface keeps growing.
- The graph shell CSS is now split by dialog surface, but the next worthwhile frontend cleanup is still around the remaining larger node/style files rather than dialog chrome.

## 2026-05-17 — Prompt Library Cleanup, One-Column Node Menu, And Larger Preview/Display Nodes

Changed behavior:

- Removed emitted legacy Prompt Recipe compatibility node definitions from the live node catalog. The system now uses one visible `prompt.recipe` definition plus backend normalization for any older workflow payloads that still contain `prompt.recipe.<recipe_key>`.
- Simplified the Nodes dialog to a single stacked column so the add-node surface is easier to scan.
- Raised the size ceilings for preview-heavy nodes:
  - `preview.image`
  - `preview.video`
  - `preview.audio`
  - `display.any`
- Raised the default preview-bearing max-size fallback in the shared graph node layout so media-preview nodes are no longer boxed in by the old 860px width cap when no tighter backend max is declared.
- Relaxed `display.any` text/media layout so long text can use more of the node height instead of being capped to a small percentage under media.

Verification:

- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py apps/api/tests/test_api_smoke.py -q`
- `npm --workspace apps/web run test`
- `npm run typecheck:web`
- `npm run lint:web`
- `git diff --check`
- Local Codex browser verification on `/graph-studio`:
  - the Prompt library remains clean and no recipe-specific compatibility nodes appear in the add-node flow
  - the run-history dialog still opens correctly after the one-column dialog CSS change
  - the generic `Prompt Recipe` node still shows backend-owned summary/help metadata

## 2026-05-17 — Prompt Recipe Graph Execution And Smoke Templates

Changed behavior:

- Added backend-owned Prompt Recipe graph execution:
  - generic `prompt.recipe`
  - dynamic `prompt.recipe.<recipe_key>` nodes from active Prompt Recipes
  - `prompt.parse` for canonical multi-prompt fanout
- Reused the shared OpenAI-compatible provider path for graph Prompt Recipes and extended it to preserve ordered multi-image inputs for recipe image modes.
- Added graph validation for Prompt Recipe runtime semantics:
  - missing/inactive recipe
  - unresolved template variables
  - image-count overflow
  - image-capability/provider mismatch
- Normalized Prompt Recipe output into one canonical result payload with `text`, `parsed_json`, `final_text`, `prompts`, warnings, and provider/model metadata.
- Added graph workflow default-field materialization on save, template instantiate, validate, estimate, and run paths so saved/template workflows no longer fail just because backend definition defaults were omitted from stored node fields.
- Refreshed built-in Prompt Recipe seed rows so optional runtime tokens such as `source_prompt` and `image_analysis` have non-empty defaults where the templates expect them.
- Seeded and refreshed repo-tracked Prompt Recipe smoke templates:
  - Text Single Prompt
  - Single Image Director
  - Multi Image Director
  - Video Director Batch
  - Storyboard 3x3
  - Analysis Only
- Updated the built-in smoke templates to carry explicit OpenRouter provider/model defaults so they can run on a clean dev database without requiring a separate saved Studio enhancement config row.

Verification:

- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`65 passed`)
- Local schema upgraded through migration `20260517_013_prompt_recipe_smoke_template_provider_refresh`
- Live control-path verification through the local app:
  - refreshed graph node definitions
  - instantiated `Prompt Recipe - Text Single Prompt`
  - created a real graph run through `/api/control/media/graph/workflows/{workflow_id}/runs`
  - run completed successfully with Prompt Recipe text output plus canonical `result` payload keys

Remaining risks:

- I did not use Chrome for browser smoke in this slice. The requested local Codex browser surface was not exposed as a callable tool in this session, and Computer Use is blocked from controlling the Codex app itself.
- Full manual QA across all six Prompt Recipe smoke workflows, especially output quality review for image/video/storyboard prompts, still belongs in the next manual pass.

## 2026-05-17 — Prompt Recipe Library Simplification

Changed behavior:

- Kept older `prompt.recipe.<recipe_key>` node types backend-loadable for compatibility, but hid them from the visible Graph Studio add/search library.
- Simplified the Prompt category back down to one visible `prompt.recipe` node plus `prompt.parse`.
- Added backend-owned Prompt Recipe catalog metadata to the generic node so the frontend can:
  - filter recipes by category
  - expose only the selected recipe's variable/custom fields
  - render recipe-specific labels, placeholders, and helper text
  - show a compact selected-recipe summary in node help
- Added workflow/template normalization so older Prompt Recipe node types are rewritten to generic `prompt.recipe` with `recipe_id` and `recipe_category` before backend default materialization.
- Added visible-if support to Prompt Recipe input ports so the generic node only shows the recipe-relevant ports.

Verification:

- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py apps/api/tests/test_api_smoke.py -q` (`142 passed`)
- `npm --workspace apps/web run test` (`38 files passed`, `255 tests passed`)
- `npm run typecheck:web`
- `npm run lint:web`
- `git diff --check`
- Local Codex browser verification on `/graph-studio`:
  - the Prompt library now shows only `Prompt Text`, `LLM Prompt`, `Prompt Concat`, `Prompt Recipe`, and `Prompt Parse`
  - selecting `Image` then `Image Prompt Director` inside the generic node filters the recipe list correctly
  - the generic node reveals recipe-specific fields with inline helper text
  - the existing single-image prompt workflow still renders a coherent final prompt in `Display Any`

Remaining risks:

- Existing already-open browser tabs can still restore stale pre-normalized workflow snapshots until they are reopened from the Workflows panel. The saved workflow/template source of truth now normalizes Prompt Recipe node types on API read.
- Full manual prompt-quality review across all recipe categories still belongs in the next manual pass.

## 2026-05-11 — Production Hardening Pass 1

Changed behavior:

- Added graph run metrics to the backend run and run-node response shape.
- Added per-node duration/output metrics and KIE validation/submit/polling timing where model nodes execute.
- Added a Graph Studio diagnostics overlay for active run status and aggregate metrics.
- Began splitting the frontend graph surface into reusable components:
  - left rail
  - toolbar/workflow menu/rename dialog
  - console
  - preview overlay
  - run diagnostics
  - node field controls
  - node media preview
- Added `limits` metadata to backend node definitions.
- Added the production node-library document.

Failed attempts or regressions found:

- The current frontend orchestrator was already too large to safely add more node families directly.
- The first hardening pass intentionally did not implement the full node roadmap; it created metrics/documentation/refactor scaffolding first.
- The first metrics migration attempt placed `metrics_json` column setup before graph tables were guaranteed to exist. Graph API startup tests caught this, and the column setup was moved into the graph schema migration.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py`
  - `npm run typecheck:web`
  - `npm run lint:web`
- Browser smoke:
  - reloaded `http://127.0.0.1:3111/graph-studio`
  - confirmed Run button, credits, restored canvas, and no browser console errors for the `3111` route

Remaining risks:

- More extraction is still needed before adding tabs, preset rendering, and video utility nodes.
- Metrics are additive and should be expanded as utility executors start producing bounded processing outputs.
- Full graph run smoke was not repeated in this pass to avoid spending live KIE credits.

## 2026-05-12 — Production Roadmap Pass 2

Changed behavior:

- Expanded backend-owned node definitions with these new node families:
  - `media.load_video`, `media.load_audio`
  - `media.save_video`, `media.save_audio`
  - `image.resize`
  - `preview.image`, `preview.video`, `preview.audio`
  - `debug.inspect`, `debug.metadata`
  - `prompt.concat`
  - `preset.render`
- Added separate graph executors for media loading/saving, image resizing, preview pass-through, debug inspection, prompt concat, and preset rendering.
- Added data-root-only media reference helpers for utility nodes.
- Added backend validation for required preset text values and required preset image slots.
- Updated the generic Graph Studio node renderer so load/save/preview media nodes are not image-only.
- Updated graph canvas media drop handling so reference/asset media can create matching image/video/audio load nodes.
- Extended graph tests to cover:
  - expanded node definitions
  - image resize plus metadata run
  - preset render required-slot blocking
  - preset render into Nano Banana Pro through the existing model execution path

Failed attempts or regressions found:

- `preset.render` needs a richer dynamic UI. This pass keeps a backend-safe generic node with JSON fields and a generic image input array, while validating the same required preset contract server-side.
- Save nodes still pass through reference outputs unless the upstream model already produced a normal Media Studio asset. Gallery registration for pure utility-node outputs should be a follow-up slice.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py`
  - `npm run typecheck:web`
  - `npm run lint:web`
- Browser smoke:
  - reloaded `http://127.0.0.1:3111/graph-studio`
  - opened the node dialog and confirmed `Resize Image`, `Render Preset`, `Load Video`, and `Metadata` render from backend definitions
  - added `Resize Image` from the dialog and confirmed its generic fields render on the canvas without a Next error overlay

Remaining risks:

- Browser smoke still needs to verify adding/running the new utility nodes from the visible UI.
- Dynamic preset fields/ports should replace the temporary JSON field UX.
- Video utility nodes are still definitions/planned only; load/save video can pass refs, but resize/trim/extract execution is not implemented yet.

## 2026-05-12 — Node Contract And Search Hardening

Changed behavior:

- Added API-side node-definition validation for stable node identity, supported port types, supported visible field renderers, port cardinality, known UI tokens, and min/default/max sizing.
- Normalized shipped node definitions with `ui.default_size`, `ui.min_size`, `ui.max_size`, `ui.color`, `ui.accent`, `ui.icon`, `ui.preview`, and `ui.field_layout`.
- Added shared frontend layout utilities for node size clamping and typed port/edge colors.
- Added shared frontend serialization helpers for new node creation, workflow save payloads, and stale saved-size clamping.
- Replaced separate Space/context/wire menus with one reusable node-search popover.
- Node search now supports Space, right-click empty canvas, double-click empty canvas, wire-release compatible search, keyboard navigation, and filters like `i:image`, `o:image`, `c:media`, and `s:system`.

Failed attempts or regressions found:

- `@xyflow/react` in this app version does not expose `onPaneDoubleClick`; the double-click behavior was moved to the canvas wrapper with node/control guards.
- Right-click on visually empty space can target React Flow overlay layers instead of the pane. Using capture-phase canvas handling made the behavior reliable while still ignoring actual node/control clicks.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py`
  - `npm --workspace apps/web run test -- graph-node-search.test.ts`
  - `npm run typecheck:web`
  - `npm run lint:web`
- Browser smoke:
  - opened `http://127.0.0.1:3111/graph-studio`
  - verified Space opens node search
  - verified `i:image` filters to image-compatible nodes
  - verified right-click empty canvas opens node search
  - verified double-click empty canvas opens node search
  - verified releasing a text wire on empty canvas opens compatible text-node search

Remaining risks:

- `graph-studio.tsx` is smaller in responsibility but still needs deeper hook extraction for run polling, media libraries, and connection state.
- The reusable search popover is in place, but automated component-level UI tests for actual DOM keyboard selection should be added when the web test environment supports React rendering.

## 2026-05-12 — Node Copy/Paste

Changed behavior:

- Added an in-app graph clipboard for selected nodes.
- Ctrl/Cmd+C copies selected nodes without writing to the system clipboard.
- Ctrl/Cmd+V pastes copied nodes with a small offset, resets run/error state, and preserves wires between copied nodes.
- Added Shift/Cmd/Ctrl-click node selection toggling so multi-node copy is reliable.

Verification:

- Passed:
  - `npm run typecheck:web`
  - `npm run lint:web`
- Browser smoke:
  - opened `http://127.0.0.1:3111/graph-studio`
  - selected two connected nodes
  - copied and pasted them
  - verified node count increased from 4 to 6 and edge count increased from 3 to 4

## 2026-05-12 — Production Systems Pass

Changed behavior:

- Node execution visuals now map through a status utility. Only `running` nodes receive the tracing border animation; `queued` is quiet, `completed` is static success, and `failed` is red.
- Added workflow transfer utilities and toolbar actions:
  - structure-only `.media-studio-graph.json`
  - media bundle `.media-studio-graph.zip`
  - import JSON or ZIP as an unsaved `Imported:` workflow
  - unsafe export values such as API-key-like fields, data URLs, and absolute local paths are stripped.
- Added SSE graph run events at `/media/graph/runs/{run_id}/events/stream`, with frontend EventSource consumption and polling fallback.
- KIE model nodes are now generated from the loaded model registry for supported image/video/audio workflow shapes while preserving the existing `model.kie.nano_banana_pro` node type.
- Added dynamic per-preset node definitions in the form `preset.render.<preset-key>`, including generated text fields and image slot ports.
- Added production image utility executors:
  - `image.crop`
  - `image.pad`
  - `image.convert_format`
  - `image.extract_metadata`
- Added ffmpeg-backed video utility executors:
  - `video.resize`
  - `video.trim`
  - `video.extract_frames`
  - `video.extract_audio`
  - `video.poster_frame`
  - `video.convert_container`

Failed attempts or regressions found:

- The first SSE endpoint test hung because it opened a queued run stream with no terminal state. The test now marks a no-start run completed before reading the stream so the stream closes deterministically.
- Dynamic preset nodes initially failed validation because the hidden generated `preset_id` field was required but not present in manually-built workflow JSON. The preset id now falls back to node definition source metadata.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py`
  - `npm --workspace apps/web run test`
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`

Remaining risks:

- Browser smoke for export/import and generated model-node search still needs to be run against the live `3111` app.
- Video utility execution depends on `ffmpeg`; nodes fail clearly when it is unavailable, but cross-platform browser smoke should verify the user-facing error.
- Workflow tabs, template browser thumbnails, run-history browsing, and bundled-output-history export remain future slices.

## 2026-05-12 — Slice 1 Artifacts, Grid Slice, Save-Many, Selective Execution

Changed behavior:

- Added graph artifact persistence for node outputs, with artifact ids attached back to graph output refs.
- Added `GET /media/graph/runs/{run_id}/artifacts`.
- Added `image.grid_slice` to split grid images into derived reference-media slices with crop/row/column lineage.
- Added `media.save_images` to promote `image[]` outputs into multiple normal Media Studio gallery assets.
- Updated `media.save_image` so reference-media inputs are promoted into gallery assets instead of only passing through.
- Added selective execution modes through `metadata.execution.mode`: enabled, frozen, bypassed, muted.
- Added runtime events for cached, bypassed, and skipped nodes.
- Added node context-menu controls, frontend badges/classes, workflow serialization, and import/export preservation for execution mode.
- Added compact multi-image preview strips for array outputs such as grid slices and save-many nodes.

Failed attempts or regressions found:

- Graph artifact rows initially returned JSON columns as strings because `value_json` and `transform_params_json` were missing from the store decoder's JSON field list. Added both to the decoder before shaping API responses.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q`
  - `npm run typecheck:web`

Remaining risks:

- Browser smoke still needs to verify the live 3111 UI for context-menu execution modes, image-array previews, drag-select, and save-many gallery visibility.
- Group-level controls remain Slice 2.
- Frozen reuse currently keys by saved workflow id and node id; run-history-driven artifact selection remains Slice 3.

## 2026-05-12 — Slice 1 Live Steve Test Follow-Up

Changed behavior:

- Lowered the Graph Studio zoom floor to allow significantly farther zoom-out on large workflows.
- Changed marquee multi-select to `Command`/`Control` + left-drag, with partial-overlap selection.
- Kept selected nodes movable as a group through React Flow's native selected-node drag behavior.
- Reduced the node right-click menu and spacebar node-search popover sizing by about 20%.
- Renamed context-menu execution actions to `Freeze output`, `Bypass`, and `Mute` so freeze is not confused with future pinned/movement-lock behavior.
- Added a forward migration for `graph_artifacts` so databases that already applied the earlier Graph Studio migration still receive the artifact table and indexes.

Failed attempts or regressions found:

- Live Steve Test initially could not poll runs because the existing local DB had graph migrations marked applied before `graph_artifacts` existed. Added migration `20260512_007_graph_artifacts` and applied it to the live DB.
- The first rerun then exposed that the missing artifact table could also make `media.load_image` fail with SQLite `near ")": syntax error` during artifact registration. The migration fixed that path.

Verification:

- Passed:
  - `npm run typecheck:web`
  - `npm --workspace apps/web run test`
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use smoke on `http://127.0.0.1:3111/graph-studio`:
  - reloaded `Steve Test`
  - ran graph run `grun_b43813eff16a`
  - confirmed all 7 nodes completed
  - confirmed `Grid Slice Image` displayed `4 images`
  - confirmed the four slice thumbnails rendered
  - confirmed `Preview Image` displayed the first slice
  - confirmed the smaller context menu and spacebar node search still open
  - confirmed the execution menu labels show `Freeze output`, `Bypass`, and `Mute`

Remaining risks:

- The live browser still reports a React hydration error from the Next.js runtime. It did not block this smoke, but it should be fixed before calling the browser surface clean.
- `Steve Test` currently saves the original generated grid through `Save Image`; it does not include `Save Images`, so the four slices are visible as graph/reference artifacts but are not promoted into gallery assets by this workflow.

## 2026-05-12 — Workflow Cleanup And Array Preview Save Follow-Up

Changed behavior:

- Added a trash button beside each saved workflow in the Workflows panel.
- Archived all saved workflows except `Steve Test` in the live development database.
- Updated `media.save_image` to accept one image or an array of up to 25 images on its `image` input.
- Updated `media.save_image` to promote every received image reference into a normal gallery asset and record `saved_asset_count`.
- Added full-screen preview navigation for image arrays:
  - grid nodes still show compact thumbnails
  - clicking a thumbnail opens the overlay
  - left/right arrows cycle through the collection
  - Escape closes the overlay
- Updated the saved `Steve Test` workflow to add a `Save Slices` node connected to `Grid Slice Image.images`.

Failed attempts or regressions found:

- Browser-use initially failed the arrow-key check because the key name was passed as `ARROWRIGHT`; retrying with `ArrowRight` verified the overlay navigation.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q`
  - `npm run typecheck:web`
  - `npm --workspace apps/web run test`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use smoke on `http://127.0.0.1:3111/graph-studio`:
  - confirmed only `Steve Test` remains in the workflow list
  - confirmed the workflow trash button is visible
  - opened a grid-slice thumbnail
  - confirmed the overlay showed `1 / 4`
  - pressed right arrow and confirmed `2 / 4`
  - pressed Escape and confirmed the overlay closed
- API smoke:
  - confirmed `media.save_image` now exposes `image` as an array input with `max=25`
  - confirmed `Steve Test` now has 8 nodes and 7 edges after adding `Save Slices`

Remaining risks:

- Dynamic fan-out into separate per-image branches is now covered by `image.split`; batch/map execution is still useful later when every item should use the same downstream model settings.
- The live browser still reports the existing React hydration warning.

## 2026-05-12 — Split Images Fan-Out Node

Changed behavior:

- Added `image.split` as a backend-owned graph node.
- The node accepts an ordered `image[]` input and exposes numbered outputs from `image_1` through `image_25`.
- The frontend shows only the requested output count, so a 4-way split displays `Image 1` through `Image 4` instead of every possible port.
- Split outputs preserve the same reference media ids from the input array and add split metadata/lineage for artifact inspection.
- A split output can now feed a separate save, prompt/model branch, or future image-to-video model node with its own prompt.

Failed attempts or regressions found:

- None in this slice. The main design adjustment was choosing a pass-through split node instead of making array-map execution the only path, because per-image prompts require separate branches.

Verification:

- Added API coverage for:
  - node definition includes `image.split`
  - split exposes 25 valid output ports
  - a 2x2 grid slice fans out into `image_1` through `image_4`
  - first and fourth split outputs can save through separate `media.save_image` nodes
  - split artifacts record `image.split` lineage

Remaining risks:

- The split node currently requires a fixed output count. A later UX pass can add quick actions like "match input count from latest run" or "create downstream nodes from all outputs."

## 2026-05-12 — Graph Studio Cleanup And Kling Video Contract

Changed behavior:

- Split shared Graph Studio helpers out of the main orchestrator:
  - `utils/graph-api.ts`
  - `utils/graph-media-preview.ts`
  - `graph-studio-constants.ts`
  - `hooks/use-graph-console.ts`
- Fixed generated KIE video model typing so task-mode/provider hints take precedence over misleading `media_types`.
- Verified `model.kie.kling_2_6_i2v` now exposes `Models/Video`, required `image_refs`, duration `5`/`10`, `sound`, and a `video` output.
- Upgraded `media.save_video` fields to include group, filename prefix, format, codec, CRF, and metadata inclusion.
- Added offline fake-video completion so video model tests create a valid small MP4 artifact when ffmpeg is available.

Failed attempts or regressions found:

- The planning bug was confirmed: Kling 2.6 I2V appeared as an image-output graph node because graph node generation trusted `media_types: ["image"]`.
- The first offline test generated a fake `.mp4` header that failed ffprobe; the fix now uses ffmpeg with `shell=False` to create a tiny valid MP4 in offline mode when ffmpeg is installed.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q`
  - `npm --workspace apps/web run test`
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Added API coverage for:
  - `model.kie.kling_2_6_i2v` definition outputting `video`
  - offline `Load Image -> Kling 2.6 I2V -> Save Video`
  - unknown `media.save_video.format` failure
- Added web coverage for finding `Kling 2.6 Image to Video` and `Save Video` through graph search.
- Browser-use smoke on `http://127.0.0.1:3111/graph-studio`:
  - reloaded the graph route
  - confirmed node search opens
  - confirmed `Kling 2.6 Image to Video`, `Kling 2.6 Text to Video`, and `Save Video` appear
  - added a temporary `Save Video` node and confirmed `Filename Prefix`, `Format`, `Codec`, and `CRF` fields render

Remaining risks:

- Live Kling 2.6 credit-spending smoke has not been run yet and still requires action-time approval.
- `media.save_video` validates transcode presets, but generated video assets should use `source_original` until the bounded asset transcode path is completed.
- `graph-studio.tsx` is smaller and has the first extracted modules, but more stateful orchestration should still move into workflow/run/media hooks before adding tabs or template UI.
- The browser route still reports the existing minified React hydration error #418 after reload; it did not block the smoke, but it remains a route cleanliness issue.

## 2026-05-12 — Graph Studio Production Hardening

Changed behavior:

- Added bounded `media.save_video` transcode for both generated video asset refs and reference-media video refs.
- Non-`source_original` Save Video presets now validate source size/duration, use ffprobe/ffmpeg with `shell=False`, import the transcoded file as reference media, and then promote it into a gallery video asset with graph lineage.
- Added multi-node context-menu targeting:
  - right-clicking a selected node applies execution/color/clear actions to the selected group
  - right-clicking an unselected node targets only that node
  - rename is single-node only
- Added Cmd/Ctrl+B and Cmd/Ctrl+M shortcuts for selected-node bypass and mute/disable toggles.
- Added clearer muted, bypassed, and frozen node visual states.
- Extracted more Graph Studio orchestration out of `graph-studio.tsx`:
  - `hooks/use-graph-media-library.ts`
  - `hooks/use-graph-node-operations.ts`
  - `hooks/use-graph-clipboard.ts`
  - `hooks/use-graph-keyboard-shortcuts.ts`
  - `hooks/use-graph-run-lifecycle.ts`
  - `utils/graph-selection.ts`
- Added a client-only Graph Studio mount guard while investigating hydration mismatch #418.

Failed attempts or regressions found:

- `toLocaleString()` in workflow timestamps was replaced with deterministic ISO-style formatting, but the route still needs a fresh browser-console check before marking hydration fully clean.
- The first extraction pass reduced the file but did not make `graph-studio.tsx` thin enough; the second pass moved clipboard, keyboard, media-library, node-operation, and run-lifecycle logic, bringing it down from roughly 2,057 lines to roughly 1,807 lines.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q`
  - `npm --workspace apps/web run test`
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Targeted checks also passed while building:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py::test_graph_save_video_transcodes_generated_asset_to_gallery_asset apps/api/tests/test_graph_studio.py::test_graph_save_video_transcodes_reference_video apps/api/tests/test_graph_studio.py::test_graph_save_video_transcode_requires_ffmpeg -q`
  - `npm --workspace apps/web run test -- graph-node-search`
- Added API coverage for generated-video transcode, reference-video transcode, and missing-ffmpeg failure.
- Added web utility coverage for selected-node context-menu targeting and selected-node execution-mode toggles.
- Browser-use smoke on `http://127.0.0.1:3111/graph-studio`:
  - opened a fresh graph tab and confirmed the route rendered Steve Test
  - reloaded the route and confirmed no new React #418 log was emitted; the only #418 entry left in browser dev logs had an older timestamp from a prior run
  - verified Cmd/Ctrl-drag selection draws a selection box
  - selected three nodes, used Cmd/Ctrl+M, confirmed three `Muted` chips rendered, then toggled them back to enabled

Remaining risks:

- Browser-use could not reliably open the custom node context menu through synthetic right-click in the automation proxy, but the right-click target behavior is covered by web utility tests and the manual UI handler remains wired through React Flow `onNodeContextMenu`.
- Live Kling 2.6 credit-spending smoke is still intentionally not run without action-time approval.
- `graph-studio.tsx` is improved but remains large; workflow/session/import/export extraction should be the next cleanup before tabs/templates.

## 2026-05-12 — Slice 0 Orchestrator Cleanup

Changed behavior:

- No intentional UI/runtime behavior changes.
- Extracted remaining high-risk orchestration out of `graph-studio.tsx`:
  - `graph-canvas.tsx`
  - `graph-library-dialogs.tsx`
  - `hooks/use-graph-connections.ts`
  - `hooks/use-graph-workflow-transfer.ts`
  - `hooks/use-graph-workflow-actions.ts`
  - `hooks/use-graph-node-previews.ts`
- Moved typed connection validation, input rewire, reconnect, manual wire drag, wire-release node search, workflow import/export, workflow CRUD actions, library dialogs, image-library dialog, and node preview hydration out of the main orchestrator.
- Reduced `graph-studio.tsx` from roughly 1,806 lines after the previous pass to roughly 1,115 lines.

Failed attempts or regressions found:

- The first canvas extraction used an unavailable `OnReconnectEnd` React Flow type. The component now uses the existing local handler shape instead.
- Browser smoke initially hit the existing stale API on port 8000, which returned 404 for graph routes even with the correct token. A current API was started on port 8111 and the temporary web server was pointed at it for validation.
- React Flow logged its stylesheet warning because local CSS changed `.react-flow__pane` to `z-index: 0`; the graph route now imports the package stylesheet directly and keeps the pane at React Flow's expected base `z-index: 1`.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q`
  - `npm --workspace apps/web run test`
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use smoke on `http://127.0.0.1:3111/graph-studio`:
  - used a current API on `8111` and web on `3111`
  - confirmed graph node definitions and workflows returned 200
  - confirmed Steve Test restored with nodes, latest status metrics, media preview, credits, and Run button
  - confirmed Space opens the node search dialog
  - confirmed no new React Flow stylesheet warning after the z-index fix; earlier warning entries were from pre-fix reloads

Remaining risks:

- Workflow tab/session work should build on these hooks instead of re-expanding `graph-studio.tsx`.
- Slices 2-5 remain unimplemented after this cleanup slice.

## 2026-05-12 — Graph Code Review Remediation

Changed behavior:

- Canonicalized saved workflow JSON so `workflow_json.workflow_id` always matches the database workflow id.
- Runtime now also forces the route workflow id into run snapshots before validation/execution, preventing stale imported ids from breaking frozen-node cache lookup.
- Graph run event pagination now uses insertion order instead of timestamp-only comparison, so SSE/poll reconnects do not skip events created with identical timestamps.
- Consolidated frontend port compatibility into `utils/graph-port-compatibility.ts` and reused it for node search filtering, handle highlighting, and edge validation.
- Run startup failures now surface in the Graph Studio console and mark nodes with a validation-style error instead of becoming an unhandled browser promise.
- Cleaned smaller media UX consistency issues: audio assets resolve as audio previews, multi-preview labels are media-type aware, and empty workflow bundles no longer warn about missing remapped media.

Failed attempts or regressions found:

- Spacebar node search can be sensitive to focus when the current browser focus remains inside a textarea; double-click empty canvas reliably opened search during browser smoke. Existing keyboard handling should be revisited when the keyboard shortcut layer is extracted further.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q`
  - `npm --workspace apps/web run test`
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use smoke on `http://127.0.0.1:3111/graph-studio`:
  - confirmed Steve Test restored with nodes and run diagnostics
  - confirmed graph definitions endpoint returned 200
  - confirmed double-click empty canvas opened node search with Grid Slice, Kling video models, Prompt Text, and Save Video visible
  - confirmed no browser console errors in the fresh smoke tab

Remaining risks:

- `graph-studio.tsx` is below the current line-count target, but workflow hydration/restore logic is still duplicated enough that the tabs/templates slice should extract it before adding more workspace behavior.
- Group frames, run history/artifact browser, tabs/templates, and full model-family QA remain the next production slices.

## 2026-05-13 — Remaining Production Slices Pass

Changed behavior:

- Added workflow group metadata support without changing the workflow database schema.
- Added group frames in the React Flow viewport, with title, color, member node ids, computed bounds, and group execution mode metadata.
- Added group actions for create-from-selected, rename, color, ungroup, and apply enabled/frozen/bypassed/muted mode to member nodes.
- Updated workflow serialization, import/export preservation, and copy/paste so groups survive saved workflows and copied fully-contained node sets.
- Added workflow-scoped run history API: `GET /media/graph/workflows/{workflow_id}/runs`.
- Added Run History to the left rail with run status, duration, node/artifact counts, artifact inspection, and run snapshot restore.
- Added template browser support in the Workflows panel using the existing graph template API.
- Added workflow tab foundation with browser-session tab state, visible tabs, new-tab action, close-tab action, dirty marker, and active-tab switching.
- Kept `graph-studio.tsx` below the 1,200-line guardrail by extracting dialog/menu rendering into `graph-studio-dialogs.tsx`.

Failed attempts or regressions found:

- The first Slice 3 integration pushed `graph-studio.tsx` over the line-count cap. Extracted the dialog/menu layer before continuing.
- The initial tab close helper used a closure-local `nextActive` assignment that TypeScript narrowed to `never`; rewrote close behavior to compute the next tab list directly.

Verification:

- Targeted checks passed while building:
  - `npm --workspace apps/web run test -- graph-node-search`
  - `npm run typecheck:web`
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py::test_graph_workflow_runs_endpoint_lists_only_selected_workflow_runs -q`
- Full gates passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`33 passed`)
  - `npm --workspace apps/web run test` (`188 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use smoke on `http://127.0.0.1:3111/graph-studio`:
  - confirmed route loads with Run button, run-history left-rail button, and new-tab button
  - confirmed no browser console errors in the smoke tab
  - confirmed Run History panel opens and shows refresh/run-history UI
  - confirmed Workflows panel shows Templates and Save current
  - confirmed new workflow tab can be created and appears in the toolbar
  - confirmed web/API proxy works when the web server is started with the same local control token as the API

Remaining risks:

- Browser-use smoke still needs a more direct group-frame interaction check; browser automation could not reliably select graph canvas nodes through the accessible DOM in this pass.
- Tab restore is a foundation pass: active tab switching restores workflow snapshots, but richer per-tab console/preview restore should be hardened with broader browser coverage.
- Group frames are visual/metadata frames; group collapse and resize handles remain follow-up work.

## 2026-05-13 — Composite Utility Node Catalog Cleanup

Changed behavior:

- Collapsed the image utility catalog into `image.transform` with operations for resize, crop, pad, convert format, and metadata extraction.
- Collapsed the video utility catalog into `video.transform` for resize/trim/container conversion and `video.extract` for poster frame, frame extraction, audio extraction, and metadata extraction.
- Removed the older granular image/video utility nodes from the node definitions returned to Graph Studio search/add menus.
- Kept legacy granular executors registered internally so existing saved workflows can still execute while new workflows use the composite nodes.
- Updated dynamic output-port filtering so composite transform/extract nodes show only the output relevant to the selected operation.
- Center-aligned the node collapse control with the status chip in both expanded and collapsed headers.

Failed attempts or regressions found:

- The first API regression run failed because `image.transform` still required `format` even when the operation was metadata extraction. Made the field optional so metadata-only runs validate cleanly.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`33 passed`)
  - `npm --workspace apps/web run test` (`189 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use smoke on `http://127.0.0.1:3111/graph-studio?remaining-slices-smoke=2`:
  - confirmed no browser console errors after reload
  - confirmed node search maps `resize` to `Image Transform`, `trim` to `Video Transform`, and `poster` to `Video Extract`
  - confirmed old `Resize Image`, `Trim Video`, and `Poster Frame` catalog entries no longer appear in node search
  - captured close-up screenshots confirming the collapse control is vertically aligned with the `completed` chip on expanded and collapsed nodes

Remaining risks:

- Existing workflows that already contain old granular utility node types still load through compatibility executors, but the UI does not yet offer an automatic migration button to replace them with the composite node equivalents.

## 2026-05-13 — Video Model Port Alignment And Node Help

Changed behavior:

- Updated generated KIE model nodes so two-frame image-to-video models expose explicit `Start Frame` and `End Frame` image ports.
- Kept multi-reference video models, such as Seedance 2.0, on generic `Reference Images` and `Video Refs` array inputs with the provider-declared maximums.
- Updated the KIE graph executor to submit `start_frame`, `end_frame`, and generic `image_refs` in the correct image order.
- Added node-level hover help that summarizes description, inputs, outputs, and fields.
- Added field-level hover help for provider option notes and valid ranges.
- Fixed backend node layout metadata so `default_size` and `min_size` expand to fit declared ports and fields instead of allowing controls to be clipped at the bottom.
- Changed right-click node creation to store the React Flow canvas coordinate, so selecting a node from search places it at the mouse pointer rather than offset from the popover.

Failed attempts or regressions found:

- The current Kling 3.0 I2V metadata declares image input `required_min=1` and `required_max=2`, so the end frame is optional. Validation now specifically requires the start frame and permits the end frame when supplied.

Verification:

- Passed:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`34 passed`)
  - `npm --workspace apps/web run test` (`189 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use smoke on `http://127.0.0.1:3111/graph-studio?remaining-slices-smoke=2`:
  - confirmed no browser console errors after reload
  - confirmed Kling 3.0 Image to Video renders `Start Frame`, `End Frame`, and `Video`
  - confirmed provider help icons appear on the node and fields
  - confirmed the added Kling 3.0 node opened with all fields visible, without bottom clipping
  - confirmed right-click add placed the new node at the clicked canvas point

Remaining risks:

- Existing saved workflows with Kling 3.0 connected to the old generic `image_refs` port need manual rewiring or a future workflow migration helper.

## 2026-05-13 — User-Facing Mute Means Cached Output Reuse

Changed behavior:

- Simplified the normal execution UX to `Enabled` and `Mute`, where `Mute` means reuse the latest valid output/artifact and do not rerun the node.
- Kept runtime compatibility by writing user-facing `Mute` as `metadata.execution.mode = "frozen"`.
- Relabeled legacy no-output `metadata.execution.mode = "muted"` as `Disabled` so old workflows remain readable without making no-output mute the default action.
- Removed the normal Cmd/Ctrl+B bypass shortcut and changed Cmd/Ctrl+M to toggle selected nodes between enabled and cached-output Muted.
- Updated node and group context menus so Bypass and no-output Disable are no longer the normal visible choices for new user actions.

Failed attempts or regressions found:

- The product contract still described Freeze, Bypass, and Mute as peer concepts after the UX direction changed. Updated the design and node-library docs so the user-facing term is now consistently `Mute`.

Verification:

- Passed targeted tests:
  - `npm --workspace apps/web run test -- graph-node-search.test.ts`
  - `npm run typecheck:web`
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py::test_graph_frozen_model_reuses_previous_output_without_resubmitting apps/api/tests/test_graph_studio.py::test_graph_selective_execution_validation_for_muted_and_unsupported_bypass -q`
- Passed full gates:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`34 passed`)
  - `npm --workspace apps/web run test` (`189 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use live workflow smoke on `http://127.0.0.1:3111/graph-studio?remaining-slices-smoke=2`:
  - created workflow `graphwf_83717e57865a` with Load Image + Prompt Text -> Nano Banana Pro -> Grid Slice -> Split Images -> four Kling 2.6 I2V branches -> four Save Video nodes
  - first live run `grun_17b1443230e2` completed in `571.8957s`, created Nano grid asset `asset_c42cc9931ae5`, four Kling video assets, and four save-video gallery outputs
  - confirmed `image.grid_slice` produced four visible slice thumbnails and `image.split` fed separate Kling branches
  - patched upstream and branches 2-4 to user-facing Muted cached-output mode, reopened the workflow row, and confirmed 14 `Muted` chips rendered
  - rerun `grun_fb37b90685a0` completed in `65.6108s`; upstream Nano/grid/slice/split and branches 2-4 emitted `node.cached`, only `kling-video-1` submitted a new KIE job, and `save-video-1` created asset `asset_944d79c1b8e4`
  - browser console errors: none

Remaining risks:

- Multi-select right-click targeting still needs a follow-up browser pass. The context menu now shows the simplified `Enabled`/`Mute` language, but modifier-click selection did not reliably open the multi-target `Mute selected` variant during this smoke.

## 2026-05-13 — Video Combine Node

Changed behavior:

- Added `video.combine` as a backend-owned Graph Studio utility node.
- The node accepts ordered numbered clip inputs, combines them into one derived reference video, and outputs `video` plus `metadata`.
- Supported v1 transitions are `hard_cut`, `crossfade`, and `fade_to_black`.
- Kept gallery promotion separate: connect `video.combine` to `media.save_video` to create the normal gallery asset.
- Added dynamic input-port visibility so `clip_count` controls visible `video_1..video_n` slots.
- Stubbed external audio mixing as a future advanced input instead of enabling partial audio behavior now.

Failed attempts or regressions found:

- The active browser tab initially restored an older 17-node session snapshot, so the smoke reloaded the saved `Nano Slice Four Kling Branches Smoke 2026-05-13T04-41-50-323Z` workflow from the Workflows dialog before running the persisted 20-node graph.
- The combined saved video did not appear in the global gallery because the target `Sadi` project is hidden from the main gallery. Opening the project workspace showed the graph-derived item.
- The gallery `media_type=video` filter was still using poster-path presence as the video test. Graph-derived Save Video assets can have a playable web path before poster generation, so the filter now uses `generation_kind = 'video'`.

Verification:

- Passed targeted tests:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py::test_graph_node_definitions_include_first_slice_nodes apps/api/tests/test_graph_studio.py::test_graph_compatible_node_filtering_by_port_type apps/api/tests/test_graph_studio.py::test_graph_video_combine_hard_cut_outputs_reference_video apps/api/tests/test_graph_studio.py::test_graph_video_combine_crossfade_then_save_video_creates_gallery_asset apps/api/tests/test_graph_studio.py::test_graph_video_combine_fade_to_black_and_validation_errors -q`
  - `npm --workspace apps/web run test -- graph-node-search.test.ts`
- Passed full gates:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`38 passed`)
  - `npm --workspace apps/web run test` (`195 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use smoke on `http://127.0.0.1:3111/graph-studio?video-combine-smoke=1`:
  - loaded `Nano Slice Four Kling Branches Smoke 2026-05-13T04-41-50-323Z`
  - appended `video.combine`, `preview.video`, and a final `media.save_video`
  - wired the four frozen Kling outputs into `video_1..video_4`
  - ran `grun_d719f0bec120`; all upstream/Kling nodes reused cached outputs, `combine-four-videos`, `preview-combined-video`, and `save-combined-video` completed
  - `video.combine` combined 4 clips in `8.4391s` and emitted reference video metadata with ordered source asset ids and transition settings
  - final Save Video created gallery asset `asset_graph_cf24018773112f8c3e73db06` in `project_ab78ce28660d`
  - opened `/studio`, opened the project workspace, and confirmed the graph-derived video tile was present; API inspection confirmed gallery payload lineage references `video.combine`
  - browser console errors: none

Remaining risks:

- A future Graph Studio node-building skill should enforce registry, executor, docs, tests, browser-smoke, and node JSON shape consistency before new node types are added.
- External audio mixing is intentionally stubbed for a later media-combine slice.

## 2026-05-13 — Dynamic Node Fields, Port Hitboxes, And Video Save Previews

Changed behavior:

- Added generic `visible_if` support to graph node fields so backend-owned node definitions can hide dependent controls until they are relevant.
- Updated `video.combine` so `Width` and `Height` only show when `Resolution = Custom`; `Transition Seconds` hides for `Hard Cut`.
- Enlarged the actual React Flow handle hitbox while keeping the visible pinhole size, which makes pulling wires from output ports easier when zoomed out.
- Added reference-video poster/thumb generation during reference media import and backfill, so graph-derived `media.save_video` assets now get `hero_poster_path` and `hero_thumb_path` when ffmpeg is available.

Failed attempts or regressions found:

- The gallery was technically saving the combined video before this pass, but the graph-derived video asset had no poster/thumb because reference-video imports only generated image thumbnails. Save Video now promotes those generated reference previews into the gallery asset.

Verification:

- Passed targeted tests:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py::test_graph_node_definitions_include_first_slice_nodes apps/api/tests/test_graph_studio.py::test_graph_save_video_transcodes_reference_video apps/api/tests/test_graph_studio.py::test_graph_video_combine_crossfade_then_save_video_creates_gallery_asset -q`
  - `npm --workspace apps/web run test -- graph-node-search.test.ts`
  - `npm run typecheck:web`
- Browser-use smoke:
  - reloaded Graph Studio and confirmed the Combine node hides `Width`/`Height` while using first-clip resolution
  - reran the visible combined-video workflow; run completed and `video.combine`, `preview.video`, and final `media.save_video` all completed
  - opened `/studio?project=project_ab78ce28660d` and confirmed the project gallery shows the new graph-derived video item
  - API inspection confirmed newest combined asset `asset_graph_b95bf7558aec975b8e022ee3` has `hero_web_path`, `hero_thumb_path`, `hero_poster_path`, and `video.combine` lineage

Remaining risks:

- Existing graph-derived video assets created before this pass may still be missing poster/thumb fields until their save path is rerun or a future media maintenance backfill updates them.

## 2026-05-13 — Zoomed Connection And Resize Hitbox Tightening

Changed behavior:

- Added a near-pin snap fallback for graph connections: when a wire is released close to a compatible input pin, Graph Studio now connects to the nearest valid target instead of opening node search.
- Applied the same near-pin fallback to input rewiring, so dragging an existing input wire near another compatible input is less brittle.
- Suppressed the canvas context/node-search menu while a wire connection is active.
- Increased the actual handle and resize-corner hit areas while keeping the visible pinhole/corner treatment restrained.

Failed attempts or regressions found:

- The previous visible pinhole enlargement was not enough at lower zoom because the release still depended on React Flow reporting an exact target. The snap fallback now handles near misses in screen space.

Verification:

- Passed:
  - `npm --workspace apps/web run test -- graph-node-search.test.ts`
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use smoke:
  - reloaded `/graph-studio?interaction-hitbox-smoke=2`
  - confirmed Graph Studio loaded the existing workflow and browser console errors were empty

Remaining risks:

- This improves low-zoom targeting, but a deeper future pass could add visible hover halos/target previews while dragging so users can see exactly which pin will receive the snap.

## 2026-05-13 — Graph Review Remediation: Save Reuse And Audio Contract

Changed behavior:

- Removed volatile upstream `source_artifact_id` from graph save-node stable identity. Save nodes now reuse the same gallery asset when the same workflow save node receives the same source asset/reference again, instead of creating a new gallery item every rerun.
- Added `audio` support to the store media-type gallery filter.
- Added an offline graph save-audio test covering `media.load_audio -> media.save_audio`, gallery asset creation, and `media_type=audio` filtering.
- Fixed generated video model nodes so provider-declared audio inputs are exposed as `audio_refs`; this makes Seedance-style reference-audio workflows visible in Graph Studio instead of silently dropping the audio input contract.
- Fixed graph media preview helpers so audio output ports are included in run asset hydration and preview collection.

Failed attempts or regressions found:

- Review found that unchanged combined videos were generating a new saved gallery asset across reruns because graph artifact ids are intentionally run-scoped. The stable save identity now uses stable media identity instead.
- Review found Seedance audio support was half-wired: executor/request paths accepted audio refs, but generated video model node definitions filtered audio inputs out.

Verification:

- Passed targeted tests:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py::test_graph_video_combine_crossfade_then_save_video_creates_gallery_asset -q`
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py::test_graph_node_definitions_include_first_slice_nodes apps/api/tests/test_graph_studio.py::test_graph_save_audio_creates_gallery_asset_and_filters_as_audio -q`
  - `npm --workspace apps/web run test -- graph-node-search.test.ts`
- Passed full gates:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`39 passed`)
  - `npm --workspace apps/web run test` (`197 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser/API smoke:
  - restarted the local API server and confirmed `model.kie.seedance_2_0` now exposes `image_refs`, `video_refs`, and `audio_refs`
  - reloaded `/graph-studio?review-audio-smoke=1` with browser-use and confirmed no browser console errors

Remaining risks:

- Full audio/video mux behavior is not implemented in `media.save_video`; audio is now better represented as graph media, but muxing needs a separate bounded ffmpeg contract and browser smoke.

## 2026-05-13 — Graph Audio Production Slice

Changed behavior:

- Added shared graph media probing for audio/video with ffprobe-backed duration, codec, sample rate, channels, bitrate, container, file size, and stream-presence metadata.
- Hardened audio reference import for wav, mp3, m4a, and aac with 100 MB / 10 minute limits.
- Upgraded `media.save_audio` with source-original, mp3, wav, and m4a/aac output formats. Transcoded audio is imported as graph reference media first, then promoted into a normal `generation_kind="audio"` gallery asset with graph lineage.
- Added optional audio input and mux controls to `media.save_video`: keep existing audio, replace with connected audio, mix with connected audio, or mute.
- Added `audio.transform` as the consolidated audio utility node for trim, convert format, normalize, and metadata extraction.
- Added Seedance audio-reference graph QA coverage with a mocked offline KIE submit path using `image_refs`, `video_refs`, and `audio_refs`.

Failed attempts or regressions found:

- The first save-audio definition made `format` required even though it had a default. Existing graph validation treats missing required fields as invalid before defaults are applied, so `format` is now optional with a default.
- A direct Seedance graph run failed because the provider validation bundle was not submit-ready for the mixed fixture request. The test now mocks the submit/poll/output path and keeps provider-specific validation delegated to Media Studio/KIE.

Verification:

- Passed targeted tests:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py::test_graph_node_definitions_include_first_slice_nodes apps/api/tests/test_graph_studio.py::test_graph_node_definitions_include_valid_layout_metadata apps/api/tests/test_graph_studio.py::test_graph_save_audio_creates_gallery_asset_and_filters_as_audio apps/api/tests/test_graph_studio.py::test_graph_save_audio_transcodes_to_mp3 apps/api/tests/test_graph_studio.py::test_graph_audio_import_rejects_unsupported_extension apps/api/tests/test_graph_studio.py::test_graph_audio_transform_normalizes_and_outputs_reference_audio apps/api/tests/test_graph_studio.py::test_graph_save_video_replaces_audio_input_and_preserves_lineage apps/api/tests/test_graph_studio.py::test_graph_save_video_mixes_and_mutes_audio apps/api/tests/test_graph_studio.py::test_graph_seedance_audio_reference_workflow_runs_offline -q`
  - `npm --workspace apps/web run test -- graph-node-search`
- Passed full graph API test gate:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`45 passed`)
- Passed full web gates:
  - `npm --workspace apps/web run test` (`198 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser/API smoke:
  - restarted the local web dev server on `127.0.0.1:3111` with `.env` loaded after finding that a bare restart caused control-token errors in the browser
  - confirmed `/graph-studio` loaded visibly in Chrome, restored the active graph workflow, loaded node definitions/workflows/templates through the control API, and displayed the updated `media.save_video` optional Audio input and mux controls
  - confirmed the node-definition API exposes 35 definitions, including `audio.transform`, `media.save_video` inputs `video` and `audio`, and Seedance inputs `prompt`, `image_refs`, `video_refs`, and `audio_refs`

Remaining risks:

- The browser-use CDP path timed out before navigation, so the visible smoke used the available Chrome/Computer Use path after the in-app browser path failed. Route/API behavior is verified, but the next media-heavy audio workflow should still be exercised interactively once real audio fixtures are selected in the UI.
- Live Seedance/KIE audio-reference spending remains gated behind explicit approval.

## 2026-05-13 — Graph Node Library And Tab Close Cleanup

Changed behavior:

- Made node library rows compact and single-line, with media-type badges/icons for Image, Video, Audio, Text, JSON, Model, and Asset-style nodes.
- Fixed workflow tab close behavior so closing the active scratch tab hydrates the previous workflow tab instead of leaving the canvas blank or drifting the first tab name.
- Added pure tab utility coverage for closing active throwaway tabs, closing inactive tabs, and preserving the current canvas snapshot.

Failed attempts or regressions found:

- Reproduced the user-reported tab issue in-browser: create a new tab, add a node, close that tab. The old close path changed active tab state without restoring the next tab workflow snapshot.

Verification:

- Passed targeted tests:
  - `npm --workspace apps/web run test -- graph-tabs graph-node-search` (`27 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Browser-use smoke:
  - reloaded `/graph-studio`
  - confirmed the Nano Slice Four Kling workflow was present before the test
  - created a new tab, opened Nodes, added Load Audio, closed the active scratch tab, and confirmed the Nano Slice Four Kling workflow plus Video Combine returned
  - confirmed no scratch Load Audio node leaked into the restored workflow and browser warnings/errors were empty

Remaining risks:

- Tabs are now safer for the close-scratch flow, but deeper per-tab console/run-preview preservation remains part of the later tabs hardening slice.

## 2026-05-13 — Graph Active Trace And Video Preview Fix

Changed behavior:

- Reworked the active running node border trace so the tracing gradient animates around the node border with a green active treatment.
- Fixed graph video previews for reference media so node video elements use the playable stored MP4 URL, with poster/thumb URLs kept as poster images only.
- Added web regression coverage so video reference previews cannot accidentally use WebP/JPG thumbnail URLs as `<video src>` again.

Failed attempts or regressions found:

- The current Nano Slice Four Kling workflow was completing successfully, but combined video and preview nodes could render grey because the preview helper selected `thumb_url` before `stored_url` for video references.
- The active run visual was receiving the right `running` status, but the border effect was too fragile and did not reliably read as a tracing border.

Verification:

- Passed targeted tests:
  - `npm --workspace apps/web run test -- graph-media-preview graph-node-search` (`27 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
- Passed full web test gate:
  - `npm --workspace apps/web run test` (`204 passed`)
- Browser-use smoke:
  - clicked Run on the current Nano Slice Four Kling workflow
  - confirmed `combine-four-videos` entered `graph-node-running graph-node-tracing`
  - confirmed downstream preview/save nodes stayed queued until active
  - confirmed the run completed, combined video and preview video completed, browser warnings/errors were empty, and all node `<video>` sources were MP4 URLs rather than WebP thumbnails

Remaining risks:

- The active trace is now CSS-driven and verified by class state in-browser. A future visual QA pass can tune trace speed/thickness if the current green trace still feels too subtle.

## 2026-05-13 — V1 Production Completion Pass: Pinned Cache And Tab State

Changed behavior:

- Added pinned cached-output support for user-facing Muted nodes. A frozen node can now target a specific prior run through `metadata.execution.cached_run_id` and optional `metadata.execution.cached_artifact_ids` instead of always using the latest completed node output.
- Added backend validation so pinned cached nodes fail before execution when the cached run output, pinned artifact rows, asset ids, or reference media ids are missing.
- Added runtime reuse of the pinned cached output path without calling the executor or submitting KIE jobs.
- Added a Run History artifact action to mute a node against a selected run artifact.
- Preserved pinned cache metadata through workflow serialization, load/restore, copy/paste, and tab snapshots.
- Hardened tab snapshots so console lines are preserved and switching back to a tab with an active run id restores that run's output snapshots/events.
- Updated Graph Studio docs to distinguish implemented foundations from remaining v1 polish.

Failed attempts or regressions found:

- The previous Muted implementation could only reuse the latest valid node output for a workflow/node id. That was not precise enough for run-history-driven restore/reuse because users could not pin a node to a specific prior artifact set.

Verification:

- Passed targeted API tests:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py::test_graph_frozen_model_reuses_previous_output_without_resubmitting apps/api/tests/test_graph_studio.py::test_graph_frozen_model_can_pin_prior_run_artifacts apps/api/tests/test_graph_studio.py::test_graph_save_node_reuses_unchanged_frozen_input_without_duplicate_asset -q`
- Passed targeted web tests:
  - `npm --workspace apps/web run test -- graph-tabs graph-serialization`
- Passed web type/lint gates:
  - `npm run typecheck:web`
  - `npm run lint:web`

Remaining risks:

- Run History still needs richer open/download/gallery actions for artifacts.
- Latest preview overlay state is mostly restored through run id/output snapshots; explicit preview-overlay tab persistence remains a final tab polish item.
- Full browser-use smoke and full API/web gates should run after this pass before checkpointing the worktree.

## 2026-05-14 — V1 Finish Pass: Groups, Audio Browser Workflows, And Low-Zoom Interaction

Changed behavior:

- Upgraded group frames into draggable workflow containers. Dragging the frame/title now moves every member node and moves the stored group bounds with the same delta.
- Tightened group membership to match the intended visual contract: a node belongs to a group when its rectangle touches or overlaps the group bounds, and it leaves only after it is completely off the group.
- Split group rendering into a background frame behind nodes and an interactive title layer above nodes so grouped nodes are not visually buried under the wrapper.
- Kept group execution node-owned: group Enable/Mute still applies `metadata.execution.mode` to every member node, with user-facing Muted mapped to cached-output `frozen`.
- Increased low-zoom wire and resize affordances: larger invisible port/resize hitboxes, wider compatible-port snap radius, and unchanged visible pinhole sizing.
- Made the load-node media picker generic for image, video, and audio references/assets instead of image-only labels.
- Created fixture reference audio/video and verified a real audio graph workflow through load audio, preview audio, audio transform, save audio, and Save Video replace/mix/mute audio mux paths.

Failed attempts or regressions found:

- The group frame was previously passive and could not act as a container. The fix keeps mutation in `use-graph-groups` through a scoped group-move event instead of adding group business logic to `graph-studio.tsx`.
- The browser workflow list needed a route reload before the newly API-created audio smoke workflow appeared in the open workflow list.
- Browser screenshot capture timed out in the in-app browser, so visual checks used DOM snapshots and direct in-browser interactions instead of screenshot evidence.

Verification:

- Passed targeted web tests:
  - `npm --workspace apps/web run test -- graph-node-search.test.ts` (`25 passed`)
  - `npm --workspace apps/web run typecheck`
- Browser-use smoke:
  - reloaded `/graph-studio` with no new console errors beyond normal dev Fast Refresh logs
  - selected two nodes, opened the selected-node context menu, created `Group 1`, opened the group context menu, and muted the group
  - created fixture reference audio/video via the existing reference-media import path
  - ran `Audio Browser Smoke 2026-05-14T01:39:22.555Z`; all eight graph nodes completed
  - loaded the audio workflow in Graph Studio and confirmed Save Video audio controls for replace, mix, and mute were visible
  - opened `/studio` and confirmed `Graph Audio Smoke Saved` plus replace/mix/mute muxed videos appeared as gallery assets; muxed videos had web/poster/thumb outputs

Remaining risks:

- Full gates still need to run after this pass.
- Group drag was covered by utility tests and code path, while browser-use validated create/mute behavior; screenshot-based drag evidence was blocked by in-app screenshot timeouts.
- Model-family live QA remains a separate final pass.

## 2026-05-14 — Pricing, Help, QA, And Node-Builder Guardrails

Changed behavior:

- Added `POST /media/graph/estimate` for server-canonical graph cost estimation keyed by node id.
- Graph estimates sum enabled KIE model nodes, including fanout branches, and treat frozen/Muted model nodes as zero new spend.
- Missing or stale pricing now returns graph and node warnings instead of silently becoming zero.
- Added optional node-level `help_text` to the backend node definition schema and generated short help for KIE model nodes.
- Added frontend pricing types, a debounced estimate hook, toolbar graph estimate chip, per-model-node estimate chips, and a run confirmation modal for over-credit or unknown-cost graphs.
- Replaced the node header native title tooltip with a compact hover/focus/click help popover.
- Created the reusable Codex skill `graph-studio-node-builder` with backend-owned definition, pricing, testing, docs, browser smoke, and `graph-studio.tsx < 1200` guardrails.

Verification:

- Passed targeted API tests:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q -k "graph_estimate or node_definitions_include_first_slice_nodes"`
- Passed full gates:
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py apps/api/tests/test_api_smoke.py -q` (`112 passed`)
  - `npm --workspace apps/web run test` (`211 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
  - `wc -l apps/web/components/graph-studio/graph-studio.tsx` (`1198`)
- Browser-use smoke:
  - reloaded `/graph-studio` with no browser console errors
  - added temporary Nano Banana Pro model nodes and confirmed the toolbar estimate and per-node `≈18 cr` chips rendered
  - clicked a node `?` control and confirmed the custom help popover stayed open with node purpose, inputs, outputs, and cost caveat
  - reloaded the saved audio workflow afterward to remove the temporary model nodes from the visible canvas

Remaining risks:

- The final live KIE pricing/spend smoke remains manual and requires action-time credit approval.

## 2026-05-14 — Collapsed Node Port Aggregation

Changed behavior:

- Matched the ComfyUI/LiteGraph collapsed-node model: expanded nodes render individual typed ports, while collapsed nodes compress all input slots to one visible left aggregate pin and all output slots to one visible right aggregate pin.
- Kept the underlying React Flow handles per-port and directional (`in:*` and `out:*`) so existing edges, serialization, and execution still preserve the real input/output ids.
- Collapsed multi-input/multi-output nodes now route incoming wires from the left pin and outgoing wires from the right pin without exposing multiple visual handles.
- Corrected the collapsed-node height contract so wire anchors are centered on the compact card instead of the expanded node box.
- Raised the aggregate pin layer above the collapsed header and hid node resize handles while collapsed so the left input pin remains visible and clickable.

Verification:

- Checked ComfyUI frontend/LiteGraph source for collapsed slot position behavior in `NodeInputSlot`, `NodeOutputSlot`, and `LGraphNode.getConnectionPos`.
- Passed web tests:
  - `npm --workspace apps/web run test -- graph-node-search.test.ts graph-tabs.test.ts graph-serialization.test.ts` (`37 passed`)
  - `npm --workspace apps/web run test` (`214 passed`)
- Passed gates:
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
  - `wc -l apps/web/components/graph-studio/graph-studio.tsx` (`1196`)
- Browser-use smoke:
  - reloaded `/graph-studio`
  - collapsed `Audio Transform` and confirmed one input aggregate pin plus one output aggregate pin
  - collapsed multi-port `Save Video` and confirmed the visual pins stayed one-per-side while hidden handles preserved `in:video`, `in:audio`, `out:asset`, and `out:video`
  - reloaded after the alignment fix and confirmed fresh browser logs had zero warnings/errors

## 2026-05-14 — End-Of-Day Graph Studio UI Polish And Guardrails

Changed behavior:

- Simplified node execution activity so status stays in the node header. `Completed`, `Cached`, and similar states render as compact chips; elapsed time renders as a separate chip only when backend metrics provide a duration.
- Removed body-level activity cards from nodes so normal run state does not add vertical spacing or compete with media/settings content.
- Simplified run console event text by mapping backend run events to human-readable lines and removing output-count/provider-check noise from normal UI.
- Added richer KIE model help content generated from node definitions. Model help now summarizes task mode, input media caps, output type/count, key settings such as aspect ratio/resolution/duration/sound, and the cost-estimate caveat.
- Widened model help popovers slightly and ensured only one pinned help popover stays open at a time.
- Adjusted workflow tabs so longer workflow names get more room and expose the full name through hover title.
- Tuned group frame visuals and layering: group fill stays behind nodes, title strips stay above nodes, wires stay below node bodies, and the title strip remains translucent enough for crossing wires to read behind it.
- Confirmed stale session behavior: a restored browser tab can show an older active workflow snapshot, while loading the saved workflow from the Workflows panel brings back the latest saved `ST Nano Slice Four Kling` version with four preview image nodes and groups.

Verification:

- Passed focused web tests after help/run-event changes:
  - `npm --workspace apps/web run test -- graph-node-search` (`34 passed`)
- Passed web gates for the final UI polish:
  - `npm run typecheck:web`
  - `npm run lint:web`
  - `git diff --check`
  - `wc -l apps/web/components/graph-studio/graph-studio.tsx` (`1186`)
- Browser-use smoke:
  - closed stale restored workflow state, loaded `ST Nano Slice Four Kling` from Workflows, and confirmed four Preview Image nodes plus `Group 1`/`Group 2`
  - verified node headers show separate `Completed` and elapsed-time chips
  - verified Nano Banana Pro help shows generated model details: inputs, outputs, aspect ratio/resolution/output format, and cost caveat
  - reloaded `/graph-studio` repeatedly with no browser console errors

Remaining risks:

- Full API/web gates should run before checkpointing a release branch.
- Tab stale-session handling should get a targeted regression smoke so saved workflow reload is never confused with session restore.
- Model help quality depends on provider metadata quality. Missing provider field `help_text` should be fixed in backend definitions/metadata rather than patched in frontend strings.

## 2026-05-14 — Graph System Review Cleanup

Changed behavior:

- Ran a focused Graph Studio engineering review across the API graph runtime, generated definitions, pricing, audio/video executors, frontend shell, canvas/node/group components, hooks, utilities, CSS, and docs.
- Fixed a workflow tab persistence bug where Save, Save As, and Rename could update the workflow record without immediately refreshing the active tab snapshot with the saved workflow id/name.
- Added semantic Graph Studio CSS tokens on `.graph-studio-shell` and moved the highest-traffic toolbar/sidebar/control colors onto those tokens so future UI cleanup has a reusable theme surface instead of more raw color drift.
- Documented the save/tab snapshot contract and the Graph Studio CSS token/layering contract.

Review findings:

- No critical security/data-loss issue was found in the inspected graph system paths.
- Main remaining maintainability risks are `apps/api/app/graph/registry.py` as a large mixed registry/generator module, `apps/web/app/graph-studio/graph-studio.css` as a large style surface, and `use-graph-connections.ts` as the central wire interaction hotspot.
- Backend graph tests are now broad for node definitions, pricing, frozen cached outputs, audio save/transform/mux, video save/combine, and import/export paths.

Verification:

- Passed targeted web tests:
  - `npm --workspace apps/web run test -- graph-tabs graph-node-search` (`38 passed`)
- Passed full review gates:
  - `npm --workspace apps/web run test` (`220 passed`)
  - `npm run typecheck:web`
  - `npm run lint:web` (`Web lint passed for 221 files`)
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`49 passed`)
  - `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_api_smoke.py -q` (`64 passed`)
  - `git diff --check`
- Current size guard:
  - `wc -l apps/web/components/graph-studio/graph-studio.tsx` (`1189`)
- Browser-use smoke:
  - reloaded `/graph-studio` and confirmed toolbar, workflow tabs, graph canvas, and loaded `ST Nano Slice Four Kling`
  - opened and closed the workflow menu successfully after the toolbar/CSS cleanup

Remaining risks:

- The next cleanup pass should split backend registry generation into family modules and move repeated CSS regions into tokenized component sections rather than changing behavior.

## 2026-05-14 — Registry And Theme Bloat Reduction

Changed behavior:

- Split static Graph Studio system node definitions out of `apps/api/app/graph/registry.py` into `apps/api/app/graph/system_nodes.py`.
- Kept generated KIE model definition logic and dynamic preset definition logic in the registry for now.
- Reduced `registry.py` from 1242 lines to 455 lines, making the remaining registry focused on dynamic/generated definitions, layout normalization, validation, and cache writes.
- Migrated common Graph Studio CSS colors/borders/text values to semantic `.graph-studio-shell` tokens. The stylesheet now uses the graph tokens for the common surface/text/border/accent palette instead of repeating raw values in high-traffic controls.

Verification:

- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q -k "node_definitions or graph_estimate"` (`4 passed`)
- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`49 passed`)
- `npm --workspace apps/web run test -- graph-node-search graph-tabs` (`38 passed`)
- `npm run typecheck:web`
- `npm run lint:web` (`Web lint passed for 221 files`)
- `git diff --check`

Remaining risks:

- `system_nodes.py` is intentionally a direct extraction and is still large. The next safe backend cleanup is to split it by family: media, image, video, audio, preview/debug, and preset.
- `graph-studio.css` still needs section/file decomposition after token migration; avoid layout changes while doing that split.

## 2026-05-14 — System Node And CSS Section Split

Changed behavior:

- Split static system node definitions into family modules:
  - `system_nodes_prompt.py`
  - `system_nodes_media.py`
  - `system_nodes_audio.py`
  - `system_nodes_image.py`
  - `system_nodes_video.py`
  - `system_nodes_preview_debug.py`
  - `system_nodes_preset.py`
- Kept `system_nodes.py` as a small order-preserving aggregator so registry generation stays backend-owned without becoming another definition dump.
- Split `apps/web/app/graph-studio/graph-studio.css` into an import hub plus section files under `apps/web/app/graph-studio/styles/`: shell/sidebar, toolbar, canvas/groups, dialogs/history, console, and nodes/wires.
- Extracted wire snap normalization into `graph-wire-snap.ts` with focused tests. Direct manual rewire drops now normalize input ports to canonical `in:<port>` handle ids and continue rejecting output handles as snap targets.
- Updated the Graph Studio design contract and node-builder skill guardrails so future static nodes and graph styles land in the correct modules instead of bloating the aggregator, registry, or CSS hub.

Verification:

- `./scripts/with_shared_python.sh -m py_compile apps/api/app/graph/system_nodes*.py`
- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`49 passed`)
- `npm --workspace apps/web run test -- graph-wire-snap graph-node-search graph-tabs` (`41 passed`)
- `npm --workspace apps/web run test` (`223 passed`)
- `npm run typecheck:web`
- `npm run lint:web` (`Web lint passed for 223 files`)
- `git diff --check`
- Browser-use reload smoke for `/graph-studio`: toolbar, tabs, canvas present; no captured console errors.

Remaining risks:

- The CSS split intentionally preserved selectors and ordering. Future layering or layout changes still need browser screenshot review.
- The next behavioral cleanup target is still deeper wire/low-zoom interaction hardening in `use-graph-connections.ts`, followed by group polish.

## 2026-05-15 — Node Authoring Guardrails

Changed behavior:

- Added `docs/graph-studio-node-authoring.md` as the implementation contract for adding or changing Graph Studio nodes.
- The guide now spells out node placement, `GraphNodeDefinition` shape, supported port and field types, connectable field rules, UI metadata, media/reference handling, executor behavior, pricing, help text, frontend boundaries, and test/browser gates.
- Updated `docs/graph-studio-node-library.md` to point implementation work at the authoring guide and keep the library doc focused on the current node catalog.
- Strengthened the reusable `graph-studio-node-builder` skill and its `references/node-contract.md` so agents must load the node contract for every new or changed node, and must load the repo authoring guide for complex/media/pricing/cache/field-port work.

Verification:

- Documentation/skill update only; no runtime code changed.

## 2026-05-15 — LLM Prompt Node V1

Changed behavior:

- Added backend-owned `prompt.llm` as a Prompt family system node.
- The node accepts optional connected `user_prompt` text, optional image input, and fields for mode, provider, model id, image-capability confirmation, system prompt, inline user prompt, image instruction, temperature, and max tokens.
- Runtime execution uses the existing OpenAI-compatible enhancement provider plumbing for OpenRouter and local OpenAI-compatible models.
- `system_prompt` supports `[user_prompt]` and `{user_prompt}` placeholders. If no placeholder is present, connected or inline user text is sent as the user message.
- Workflow JSON stores safe provider/model ids and node fields only; API keys stay in Settings/env, images are resolved from data-root media refs at execution time, and raw provider payloads are not persisted in graph outputs.
- Graph pricing now reports enabled `prompt.llm` nodes as unknown external LLM pricing instead of silently reporting zero. Frozen/muted prompt LLM nodes estimate zero new spend.

Verification:

- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`52 passed`)
- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py apps/api/tests/test_api_smoke.py -q` (`116 passed`)
- `npm --workspace apps/web run test -- graph-node-search.test.ts` (`35 passed`)
- `npm --workspace apps/web run test` (`224 passed`)
- `npm run typecheck:web`
- `npm run lint:web` (`Web lint passed for 223 files`)
- `git diff --check`
- `wc -l apps/web/components/graph-studio/graph-studio.tsx` (`1189`)
- Saved local workflow `graphwf_f251484a6197` (`LLM Prompt V1 Test Workflow`) with three `prompt.llm` branches: text-only, image + system prompt, and connected user prompt + system prompt.
- Browser smoke at `http://127.0.0.1:3111/graph-studio`: no console errors; browser fetch confirmed `prompt.llm` exists in node definitions and saved workflow `graphwf_f251484a6197` contains three LLM Prompt nodes.

Remaining risks:

- OpenRouter/local token-price estimation is still not mapped, so `prompt.llm` intentionally triggers the unknown-cost confirmation path.
- Provider model discovery remains a Settings/probe workflow in v1. A richer searchable model picker can be added later as a reusable field type.

## 2026-05-15 — Prompt Text Connected Input

Changed behavior:

- Upgraded `prompt.text` from typed-only text into a connectable text utility node.
- Added an optional `text` input port and made the `text` textarea a connectable field, so LLM output or another text node can drive the prompt value.
- Added `mode` options: `replace`, `append`, and `prepend`. Replace passes connected text through; append/prepend combine the connected value with the typed prompt using a blank-line separator.
- Runtime output keeps text values media-safe and records metadata for mode and connected input count.

Verification:

- API tests cover the definition contract and a connected Prompt Text workflow through `debug.inspect`.
- Web tests cover node search/input-output filtering and text-port compatibility.

## 2026-05-15 — Muted Branch Validation Semantics

Changed behavior:

- Refined user-facing Muted/frozen behavior so muted nodes no longer block a run just because they have no previous cached output.
- A muted node now reuses cached output when available, skips cleanly when no enabled downstream node needs it, and fails validation only when an enabled downstream node requires data that the muted node cannot provide.
- Runtime now records uncached muted nodes as skipped with `skip_reason = "missing_cached_output"` instead of failing the entire graph.
- Validation console output now includes node labels/ids in failure messages so repeated errors identify the nodes involved.

Verification:

- Added API coverage for an uncached muted side branch that does not block an enabled branch.
- Added API coverage for an enabled required dependency that still fails when its muted upstream node has no cache.
- Re-ran the saved `LLM Prompt OpenRouter Live Test Workflow`; enabled image-description branch completed while uncached muted side branches skipped.

## 2026-05-15 — Ordered Media Reference Badges

Changed behavior:

- Added computed reference badges for load media nodes connected into multi-reference array ports, starting with image references.
- The UI now shows small Comfy-style badges such as `image reference 1` and `image reference 2` on source `Load Image` nodes when they feed a model `image_refs` input.
- Badge order is derived from current edge order into the target array port and is not stored in workflow JSON.
- Added a focused utility for badge calculation so future video/audio reference badges and prompt helper suggestions can reuse the same ordering rule.
- Documented the system-prompt preset direction: reusable director/rewrite prompts should use the existing Media Studio system prompt store and later feed `prompt.llm` through a picker, while presets remain structured generation recipes.

Verification:

- `npm --workspace apps/web run test -- graph-node-search.test.ts` (`37 passed`)
- `npm --workspace apps/web run test` (`228 passed`)
- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py apps/api/tests/test_api_smoke.py -q` (`119 passed`)
- `npm run typecheck:web`
- `npm run lint:web` (`Web lint passed for 224 files`)
- `git diff --check`
- `wc -l apps/web/components/graph-studio/graph-studio.tsx` (`1194`)
- Saved local workflow `graphwf_db7272fb5796` (`Reference Badge Smoke`) with two `Load Image` nodes, a `Prompt Text` node, and `Nano Banana Pro` using the prompt tokens `[image reference 1]` and `[image reference 2]`.
- Browser smoke loaded `Reference Badge Smoke` from the Workflows dialog and verified the active tab plus two rendered badge texts on the canvas.

Remaining risks:

- Browser screenshot capture timed out in the current in-app browser session, so this smoke used DOM and computed-style verification rather than a screenshot artifact.
- The `@` prompt-token picker from the Media Studio gallery composer is not yet wired into Graph Studio prompt fields.
- No live Nano Banana job was run in this slice; live KIE spend still requires action-time approval.

## 2026-05-15 — Prompt Text Mode Visibility Example

Changed behavior:

- `Prompt Text` now hides its `Mode` field until the `text` input has an incoming wire.
- Select fields with a real default no longer show the generic empty `Auto` option, so connected `Prompt Text` mode choices are only `Replace`, `Append`, and `Prepend`.
- Added generic frontend support for backend-declared `ui.connection_dependent_fields`, keeping the visibility rule definition-owned instead of hard-coding it into the Graph Studio shell.
- Saved and ran `graphwf_1241df48c5ec` (`Prompt Text Mode Examples`) to demonstrate:
  - `Replace`: connected text becomes the output and the typed fallback is ignored.
  - `Append`: connected text, blank line, typed suffix.
  - `Prepend`: typed prefix, blank line, connected text.
- The existing `debug.inspect` node is the current "display anything" debug tool: it accepts `text`, `image`, `video`, `audio`, `asset`, `job`, and `json` inputs and emits a JSON inspection payload. It is useful for tests/debugging but is not yet a polished user-facing Display Anything node.

Verification:

- `npm --workspace apps/web run test -- graph-node-search.test.ts` (`38 passed`)
- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`55 passed`)
- Browser smoke loaded `Prompt Text Mode Examples`; the source node hid `Mode`, connected nodes showed only `Replace`/`Append`/`Prepend`, and the run status was completed.

## 2026-05-15 — Workflow Menu Anchoring And Unused Model Output Validation

Changed behavior:

- Confirmed the workflow action dropdown is rendered inside the active tab shell so Save/Save As/Export/Rename/Close open under the selected tab rather than at the left edge of the tab strip.
- Added API coverage for enabled KIE/model nodes with media outputs but no downstream consumer.
- Validation now rejects this shape before execution with `model_output_unconnected`, scoped to the model output port, so Graph Studio can red-highlight the node and print the validation failure in the console before any paid model submit path is reached.
- Updated the Kling 3 frame-port validation fixture so the valid case includes a downstream Save Video consumer.

Verification:

- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py::test_graph_kling_3_i2v_validates_start_and_end_frame_ports apps/api/tests/test_graph_studio.py::test_graph_validation_rejects_unconnected_model_output apps/api/tests/test_graph_studio.py::test_graph_validation_rejects_empty_load_image_for_required_save_input -q` (`3 passed`)

## 2026-05-15 — Wire Delete Control And Display Any Node

Changed behavior:

- Added a selected-wire delete control. Clicking an edge now selects it and renders a compact midpoint delete button, which removes only that specific wire. This is intended for array inputs such as Nano Banana `Reference Images`, where multiple refs may feed the same port.
- Added backend-owned `display.any` in the Preview family. It accepts one `any` input, emits a pass-through `value` output plus a JSON inspection payload, and uses a focused runtime executor instead of frontend-only behavior.
- Added a compact `Display Any` renderer that shows resolved media previews when the pass-through refs point at assets/reference media and formatted text/JSON for value payloads.
- Kept the edge delete behavior in `graph-edge.tsx`/`graph-canvas.tsx`, kept CSS in `styles/nodes-wires.css`, and kept the Graph Studio shell under the 1200-line guardrail.

Verification:

- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q` (`57 passed`)
- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py apps/api/tests/test_api_smoke.py -q` (`121 passed`)
- `npm --workspace apps/web run test -- graph-node-search` (`38 passed`)
- `npm --workspace apps/web run test` (`229 passed`)
- `npm run typecheck:web`
- `npm run lint:web` (`Web lint passed for 226 files`)
- `git diff --check`
- `wc -l apps/web/components/graph-studio/graph-studio.tsx` (`1195`)
- Browser smoke loaded `Reference Badge Smoke`, confirmed three image-reference badges and five edges, clicked a specific wire to show the midpoint delete button, deleted one wire from the active unsaved canvas, and confirmed the saved workflow reload restored all five edges.
- Browser smoke created and ran `Display Any Smoke`; the `Display Any` node rendered the connected text output with no node errors.

Follow-up fix:

- Centered custom edge anchors on the visual pinhole instead of the outer edge of the React Flow handle. This removes the visible gap where wires appeared to stop just outside connected pins, especially around model nodes with external price/reference badges.
- Made wire delete arming less brittle by handling intentional edge click/mouse-down/pointer-down on the custom edge hitbox. Removed hover arming because the broad low-zoom hitboxes caused pointer movement to re-render the canvas and feel laggy.
- Reduced the invisible hitbox width at low zoom, shrank the delete button to 16px, and made the armed wire highlight bright yellow-green (`rgb(234, 255, 98)`) at 4px so selected state is obvious.
- Browser smoke verified a visible wire exposes the 16px midpoint delete button, the armed wire uses the bright selected color, clicking the background clears the armed state/delete button, and the path starts at the source pin center.
- Replaced the extra custom edge hitbox with React Flow's built-in `react-flow__edge-interaction` path and made the `.react-flow__nodes` wrapper transparent to pointer events while keeping real nodes interactive. This fixes the case where the nodes layer sat above the SVG wire and prevented normal edge selection.
- Browser smoke verified the interaction path is now the top clickable target, selecting it arms the wire with the 16px delete control and bright selected stroke, and clicking the canvas background clears the armed wire.
- Fixed floating node badges so pricing/reference badges stay absolute visual chrome instead of participating in the node flex layout. The broader child z-index rule was overriding `position: absolute`, making priced nodes taller and shifting port rows/wires.
- Matched the visible handle size to the edge anchor radius so model-node price badges do not make pin/wire alignment look offset.
- Tightened input cardinality contracts: non-array input ports now reject more than one incoming edge in backend validation, even if a node definition forgot to set `max=1`.
- Changed `display.any` to a single-value display node (`value` max 1). Multi-input inspection remains available through `debug.inspect`, and array ports such as model `image_refs` remain explicitly array-shaped with their own max limits.
- Cleared wire selection after successful connection gestures. Newly created or snapped edges are inserted unselected, existing selected edges are cleared during connect/rewire paths, and the canvas drops any lingering wire-delete armed state when a connection drag ends. A short post-connect suppression window now prevents the mouse-up/click that follows a drag from immediately re-selecting the newly connected wire.

## 2026-05-15 — Graph Studio Weekly Cleanup Review

Changed behavior:

- Ran a focused engineering cleanup pass across the current Graph Studio shell, workflow restore paths, CSS layering, node/wire interaction, and docs.
- Extracted saved-workflow canvas hydration into `apps/web/components/graph-studio/utils/graph-workflow-hydration.ts` so normal workflow load, browser-session restore, latest-run restore, and direct run restore share one node/edge/group reconstruction path.
- Added web coverage for the shared hydration utility, including saved UI metadata, frozen cache metadata, run-node output snapshots, and unselected hydrated edges.
- Split the oversized node/wire stylesheet into section files under `apps/web/app/graph-studio/styles/nodes/` while preserving selector order and keeping `nodes-wires.css` as the import hub.
- Reduced `apps/web/components/graph-studio/graph-studio.tsx` from `1195` lines to `1037` lines.

Verification:

- `npm --workspace apps/web run test -- graph-serialization graph-tabs graph-wire-snap graph-node-search`
- `npm run typecheck:web`
- `npm run lint:web`
- Browser-use reload smoke for `/graph-studio`: toolbar, tabs, canvas, nodes, and wires rendered; node CSS loaded; no captured console errors.
- Browser-use wire regression smoke: deleting and reconnecting a wire left one connected edge with no selected state and no delete button.

## 2026-05-17 — Text Node And Display Any Resize Hardening

Changed behavior:

- Reproduced the issue on a live Prompt Recipe workflow with a real loaded reference image: `Display Any` rendered the prompt output but defaulted too small for long text, and its resize target was narrower than the standard node resize zone.
- Increased backend-owned default/min/max sizing for `display.any` so long prompt output has more room before manual resize is needed.
- Increased backend-owned default/min/max sizing for `prompt.text` so reusable text/prompt nodes are less cramped by default.
- Restored a larger invisible bottom-right resize hit target for `Display Any` and textarea-heavy nodes, while keeping the resize affordance visually quiet.

Verification:

- Local Codex browser smoke on `/graph-studio` loaded `Prompt Recipe - Single Image Director`, attached a real reference image from the Media Library, ran the workflow, and confirmed the output prompt rendered in `Display Any`.
- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -q`
- `npm --workspace apps/web run test`
- `npm run typecheck:web`
- `npm run lint:web`

## 2026-05-17 — Experimental Rollout Hardening

Changed behavior:

- Added persisted actual OpenRouter usage tracking for successful OpenRouter-backed Studio flows, including Studio enhancement preview, Prompt Recipe drafting, Graph `prompt.llm`, and Graph `prompt.recipe` analysis/final calls.
- Added summary/list API routes and surfaced actual OpenRouter spend in Settings, Pricing, and Graph run history while keeping KIE estimates separate.
- Hardened Graph tab/session restore so clean saved tabs reload from the database-backed workflow record, legacy Prompt Recipe compatibility snapshots are discarded, and the browser-session cache is kept as a convenience layer instead of the workflow source of truth.
- Froze the current v1 node-family boundary in docs: system nodes, generated model nodes, and data-backed Prompt Recipe/Preset nodes only. End-user custom executable nodes remain out of scope.
- Added an idempotent DB cleanup migration that archives duplicate Prompt Recipe smoke workflows and rollout-only dev copies without touching arbitrary user-authored workflows.

Verification:

- `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_api_smoke.py apps/api/tests/test_db_admin.py apps/api/tests/test_graph_studio.py -q`
- `npm --workspace apps/web run test`
- `npm run typecheck:web`
- `npm run lint:web`
