# Graph Studio Design Contract

Graph Studio is Media Studio's node workflow editor. It is inspired by node-graph tools, but it is not a tensor graph and it is not a clone of ComfyUI. It is a Media Studio artifact/job graph.

This document locks down the UI and engineering rules we have learned from the first working slice.

## Source Of Truth

- Backend-owned node definitions drive the UI.
- Media Studio keeps one model registry, one pricing system, one asset library, one reference-media system, and one job system.
- Graph Studio cost estimates are server-canonical through `POST /media/graph/estimate`; the browser renders estimates and warnings only.
- Graph Studio submits model work through the existing Media Studio service/KIE path.
- Workflow JSON stores durable ids and structured fields, not raw media blobs, base64, or browser filesystem paths.

## Current V1 Graph Shape

The first vertical slice is:

```text
Prompt Text -> Nano Banana Pro -> Save Image
Load Image  -> Nano Banana Pro
```

The backend already owns the core graph modules under `apps/api/app/graph/`. The frontend currently renders generic nodes from definitions under `apps/web/components/graph-studio/`.

## Current Implemented Foundation

The current foundation is no longer only the first Nano image pipeline. Graph Studio now has these production-shaped building blocks:

- backend-owned node definitions with typed ports, fields, limits, execution metadata, and UI layout metadata
- generated KIE model nodes for supported image/video/audio workflow shapes, with `model.kie.nano_banana_pro` preserved for existing workflows
- generic and dynamic `preset.render` nodes that render existing Media Studio presets into prompt/image-ref outputs
- image utility node foundation, including resize, crop, pad, format conversion, metadata extraction, and preview
- video utility node foundation, including load/save/preview plus ffmpeg-backed resize, trim, frame extraction, audio extraction, poster frame, and container conversion
- audio utility foundation, including load/save/preview, ffprobe metadata, bounded save transcode, and a consolidated `audio.transform` node
- graph pricing estimates with toolbar totals, per-model-node estimate chips, stale/unknown warnings, and spend-risk confirmation before run creation
- compact node help popovers sourced from node descriptions, node `help_text`, port descriptions, and field `help_text`
- generated video model contract hardening for KIE models whose task mode implies video output even when provider metadata lists image media
- Comfy-like `media.save_video` fields for group, filename prefix, format, codec, CRF, metadata inclusion, and optional audio mux policy, with bounded ffmpeg transcode/mux for generated assets and reference media
- workflow import/export for structure-only JSON and reference-media ZIP bundles
- run events through SSE with polling fallback
- node copy/paste, multi-select context actions, rename, color, resize, collapse, status visuals, execution-mode visuals, and typed wire styling
- frontend cleanup extraction for shared Graph Studio API, media-preview, color constants, console, media-library, node-operation, clipboard, keyboard-shortcut, and run-lifecycle hook modules

The next phase should not rebuild these foundations. It should add durable artifact lineage, selective execution, multi-output handling, and group-level workflow controls.

## UI Contract

### Node Discovery

- Node creation uses one reusable search popover.
- Space opens node search when focus is not in an input, textarea, or select.
- Right-click empty canvas opens node search at the cursor.
- Double-click empty canvas does not open node search; this avoids accidental node-list popups while panning, selecting, or editing dense workflows.
- Releasing a new wire on empty canvas opens the same popover filtered to compatible node inputs.
- Search supports keyboard navigation with ArrowUp, ArrowDown, Enter, and Escape.
- Search filters:
  - `i:image`: nodes with compatible image inputs
  - `o:image`: nodes with image outputs
  - `c:media`: category match
  - `s:system`: source kind match
- Search ranking prefers exact title/type matches, then aliases, category, title/type containment, and description.

### Shell

- `/graph-studio` is a full-screen work surface.
- Top toolbar contains workflow name/menu on the left and credits plus `Run` on the right.
- The left rail is icon-only:
  - Workflows
  - Nodes
  - Images
  - Minimap toggle
- The console is hidden or shown with `c` when focus is not in a text field.
- Escape closes active dialogs, image previews, menus, and overlays.

### Workflow Menu

The workflow name acts as the menu button.

Menu actions:
- `Save`: updates the current workflow record.
- `Save As`: creates a copied workflow record and switches to it.
- `Export Workflow`: downloads structure-only `.media-studio-graph.json`.
- `Export Workflow Bundle`: downloads `.media-studio-graph.zip` with referenced reference-media files.
- `Import Workflow`: loads JSON or ZIP into an unsaved `Imported:` workflow and remaps bundled media through reference-media import.
- `Rename`: opens an in-app rename dialog. Do not use `window.prompt`.
- `Close`: closes the active canvas session and returns to blank `New workflow`. Close does not delete the saved workflow.

Workflow tabs are implemented as browser-session workspace state. Tabs preserve workflow JSON, workflow identity, dirty state, active run id, and console lines; saved workflows remain database-backed and closing a tab never deletes a workflow.
The workflow action menu is anchored to the active tab shell, not to the left edge of the tab strip, so opening it from a right-side tab keeps the dropdown under that tab.

Important reload behavior:

- Loading a saved workflow from the workflow browser is the source-of-truth reload path.
- Browser session restore can reopen a previously active tab snapshot. If a saved workflow appears stale after recent edits, close the tab/canvas and load the saved workflow record from Workflows.
- Closing the active workflow returns the tab to a blank `New workflow`; it does not delete the saved workflow record.
- Save, Save As, and Rename must update the active tab snapshot with the saved workflow id/name immediately after the API write succeeds. Do not rely on React state settling later to update visible tab labels.

### Nodes

- Nodes are resizable in width and height.
- Resize handles should stay visually quiet and should not add visible chrome.
- Nodes have minimum width/height constraints so users cannot hide required controls.
- Node dimensions come from backend `ui.default_size`, `ui.min_size`, and `ui.max_size`, then the frontend clamps saved stale sizes against those constraints.
- Node header/border/handle styling comes from backend `ui.color`, `ui.accent`, and `ui.icon` metadata.
- Selecting a node should show a simple stronger border, not add layout space.
- Shift/Cmd/Ctrl-click toggles node selection for multi-node operations.
- Cmd/Ctrl-left-drag draws a selection box on the canvas.
- Dragging a selected node moves the selected node group together.
- Right-clicking a selected node opens a context menu targeting all selected nodes; right-clicking an unselected node targets that node only.
- Ctrl/Cmd+C copies selected nodes into the in-app graph clipboard.
- Ctrl/Cmd+V pastes copied nodes with a small offset and preserves wires between copied nodes.
- Ctrl/Cmd+M toggles selected nodes between enabled and user-facing Muted, which reuses the latest valid output without rerunning.
- Bypass remains an advanced utility-only action and should not be part of the normal keyboard surface.
- Running nodes use a slow tracing border animation.
- Queued nodes must not animate.
- Failed nodes use a thick red border and visible node-level error state.
- Completed nodes can show a subdued success border.
- Run state chips stay in the node header. Do not add body panels for normal execution state. If timing is available, show it as a separate compact chip such as `0.49s`; keep `Completed`, `Cached`, `Processing`, and the time value as separate visual tokens.
- Node run activity is derived from backend graph run events and run-node metrics. Do not invent provider phases that are not emitted by the backend.
- When a load media node feeds a multi-reference media input, such as `image_refs`, the source node shows a small computed badge such as `image reference 1`. The badge is display-only, derived from current edge order, and is not persisted into workflow JSON. Prompt text can then use the matching token, for example `[image reference 1]`.

### Styling And Theming

- Graph Studio styling is rooted at `apps/web/app/graph-studio/graph-studio.css`; that file is an import hub for section files under `apps/web/app/graph-studio/styles/`.
- New graph UI should use the semantic CSS tokens on `.graph-studio-shell` for common surfaces, text, borders, accent, and control radius before adding new raw colors.
- Reusable graph components should expose classes that consume those tokens; avoid one-off global selectors and local hard-coded palettes.
- Large visual changes should preserve the existing layer contract: groups behind nodes, group title strips above nodes, wires below node bodies, popovers above all graph content.
- Keep CSS split by behavior surface: shell/sidebar, toolbar/tabs, canvas/groups, dialogs/history, console, and nodes/wires. The nodes/wires surface is further split under `styles/nodes/` into core status, header/help, media/display, fields/ports, and wires/controls. Preserve import order when moving selectors because graph z-index and React Flow overrides are layer-sensitive.

### Node Help

- The `?`/info control opens a compact hover/focus/click popover.
- Generic system nodes use `help_text`, `description`, visible input/output labels, and field `help_text`.
- KIE model nodes use generated help from backend node definitions:
  - model output media type and task modes from `source`
  - prompt/media input requirements from typed ports and `limits.input_contract`
  - output count from `limits.output_count`
  - important settings from visible field options, such as aspect ratio, resolution, format, duration, and sound
  - a short cost note that estimates are calculated before Run
- Keep model help compact. It should answer "what does this node need, what does it produce, and what settings matter" without dumping provider payloads or long docs.
- Help popovers are rendered in a portal above nodes and wires. Opening one pinned help popover closes other pinned help popovers.

### Media Previews

- Load and Save media nodes own previews.
- Model nodes should not show output preview panels by default. Their output flows to preview/save nodes.
- Clicking a preview opens a full-screen preview overlay.
- Escape closes the preview overlay.
- Load Image nodes support:
  - drag/drop media
  - click to choose from the image library
  - replace
  - remove
- Preview metadata belongs in the node footer/lower metadata area, not over the image:
  - aspect ratio
  - resolution
  - media type when useful

### Ports, Fields, And Wires

Ports are values passed between nodes.

Fields are editable node settings.

If a field can accept a connected value, the field should behave as a connectable field:
- The visible field remains in the node.
- The input port attaches near that field.
- When a wire is connected, the field is disabled/greyed out because the value comes from upstream.
- The backend still validates the resolved field value before execution.
- Fields that only matter for connected input behavior can be declared as connection-dependent in node `ui` metadata. For example, `prompt.text` hides `Mode` until its `text` input is wired, because replace/append/prepend only affect connected text.

Wire behavior:
- Output ports can start new wires.
- An input port accepts only the configured cardinality unless marked array/dynamic.
- If an input already has a single wire, dragging from that input should detach the existing edge into the user's pointer.
- Clicking a wire selects it. A compact delete button appears at the wire midpoint so one specific connection can be removed without disturbing other edges on the same array input.
- The edge should stay visually attached to its original source while dragging.
- If released on another compatible input, reconnect it.
- If released on empty canvas, remove it.
- If released back on the same input, keep/reconnect it.
- Wires should be color-coded by data type.

Validation behavior:
- Enabled KIE/model nodes that produce image, video, or audio media must connect at least one media output to a downstream node before Run.
- This prevents credit-spending model jobs that would generate media with no preview, save, inspect, or downstream consumer.
- The validation error is scoped to the model node, so the UI marks that node failed/red and the console reports the specific node-level validation message.
- Muted/frozen nodes are handled by the selective-execution cache rules instead of this unused-output rule.
- Wires should not animate during idle state. Execution animation can be added later.
- Wires remain below node bodies so they do not draw over media/fields. Group title strips are above nodes, with a translucent surface so wires crossing behind the strip still read without globally raising all wires above nodes.
- Media reference order is determined per target array port by edge order. The first image edge into a model `image_refs` port is `image reference 1`, the second is `image reference 2`, and so on. This rule should stay consistent between badges, prompt helper UI, provider payload assembly, validation, and future import/export migrations.
- `display.any` is the user-facing mixed preview/inspection node. It accepts one graph value, displays media previews when refs resolve to assets/reference media, and shows text/JSON payloads without creating gallery assets. Multi-input inspection remains the role of `debug.inspect`.

Core types:
- `image`
- `video`
- `audio`
- `text`
- `json`
- `asset`
- `reference_media`
- `job`
- arrays of those types where explicitly declared

Do not add `tensor` or `latent` until Media Studio actually supports local ML execution.

## Presets In Graph Studio

Presets should enter Graph Studio as a reusable sync node, not as a separate model system.

Recommended node:

```text
preset.render
```

Graph Studio also exposes dynamic per-preset render nodes:

```text
preset.render.<preset-key>
```

Purpose:
- Load a Media Studio structured preset.
- Render its prompt template from graph field values and connected media slots.
- Output a prompt and ordered image references that can feed model nodes.

Fields:
- `preset_id`: preset picker
- generated text fields from `input_schema_json`
- generated choice fields from `choice_groups_json`

Dynamic input ports:
- one image input per preset `input_slots_json` item
- required/optional state comes from the preset slot
- port labels should use the preset slot label, not internal ids

Outputs:
- `prompt`: text
- `image_refs`: image[]
- `preset`: json metadata
- `recommended_models`: json or string[]

Execution:
- sync node
- uses existing preset rendering/validation helpers where possible
- does not submit a model job
- downstream KIE model nodes remain responsible for model validation and submission

Why this shape:
- A preset can feed Nano, GPT Image, or another compatible model without duplicating model nodes.
- A single prompt/preset node can drive multiple model nodes.
- Preset slots map cleanly to graph image inputs.
- Existing preset import/export remains unchanged.

## System Prompt Presets

Graph Studio should reuse the existing Media Studio system prompt store for reusable LLM/director instructions instead of hard-coding prompt libraries into nodes.

Recommended direction:
- Add a Settings/Admin surface for system prompts alongside Models, Presets, and Prices, or expose it as a focused "System Prompts" section if the list grows.
- Store reusable prompts with `key`, `label`, `status`, `content`, `role_tag`, category tags, and applicable model/task metadata.
- Categories should be practical graph authoring filters, such as `image director`, `video director`, `image description`, `grid-to-prompts`, and `prompt rewrite`.
- `prompt.llm` should eventually offer a system-prompt preset picker filtered by category/model support, plus a custom override textarea for workflow-specific edits.
- Presets remain for structured Media Studio generation recipes. System prompts are reusable LLM instructions that can produce prompts, JSON prompt lists, image descriptions, or video-direction text for downstream graph nodes.
- The graph prompt-field helper should reuse the gallery composer reference-token pattern so typing `@` can suggest connected media references like `[image reference 1]` once that UI is added.

## System Node Roadmap

System and utility nodes should stay flexible. One node with clear fields is better than many hardcoded variants.

Initial utility families:
- `media.load_image`
- `media.load_video`
- `media.save_image`
- `media.save_video`
- `image.transform`
- `image.grid_slice`
- `image.split`
- `video.transform`
- `video.extract`
- `prompt.text`
- `prompt.enhance`
- `preset.render`
- `preview.image`
- `preview.video`
- `debug.inspect`

Important rule:
- Utility nodes must be bounded. Image/video processing needs max size, max duration, max frames, timeouts, and data-root path checks.

## Runtime Events

- Polling remains the fallback run-update transport.
- SSE is available at `/media/graph/runs/{run_id}/events/stream`.
- SSE clients should reconnect with `after_event_id` when needed and avoid duplicating console output.
- The UI should treat run/node state from the server as authoritative.

## Graph Artifacts And Derived Media Contract

Graph Studio needs a first-class way to represent media created by utility nodes, not only media created by KIE model jobs.

Terminology:
- `artifact`: a graph/runtime lineage record for a node output
- `reference media`: a local reusable media file stored by Media Studio
- `asset`: a gallery-visible Media Studio item
- `derived media`: media created from another asset/reference through a graph transform, such as resize, crop, slice, video combine, pad, or format conversion

Storage rules:
- Model nodes create normal Media Studio assets and also register graph artifacts for the output ports.
- Utility nodes create reference media plus graph artifacts by default.
- Save nodes promote selected artifacts/reference media into normal gallery assets.
- Utility-generated media should not automatically appear in the gallery unless connected to a save node.
- Original model outputs remain separate from derived outputs.

Lineage rules:
- Every artifact should record workflow id, run id, node id, node type, output port, media type, and output kind.
- Derived artifacts should also record parent artifact id, parent asset id or reference id, transform type, and transform parameters.
- Sliced images from a grid should point back to the original grid image and record row/column index, detected crop rectangle, gutter handling, and output format.
- Resized, cropped, padded, and converted media should preserve parent lineage even when later promoted into gallery assets.
- Combined videos should record ordered source clips, clip artifact ids, transition settings, output format, resolution, fps, and duration.
- Audio-derived outputs should record source audio ids/artifacts, codec/container metadata, sample rate/channels, transform type, and save/mux settings.

User-facing behavior:
- A model output grid remains one original generated asset.
- `image.grid_slice` can produce four, nine, or more derived image artifacts.
- `image.split` can expose those ordered `image[]` items as separate numbered outputs when each slice needs a different prompt, model node, or downstream branch.
- `media.save_images` can promote all slice outputs into separate gallery assets.
- `video.combine` can combine generated branch videos into one derived reference video; `media.save_video` promotes that combined result into one normal gallery asset.
- `media.save_video` can optionally replace, mix, or mute audio during gallery promotion. The muxed result is still a derived reference video first, then a gallery asset.
- `audio.transform` can trim, convert, normalize, or inspect audio before the result is saved with `media.save_audio` or muxed into `media.save_video`.
- The gallery should be able to show the saved slices as normal assets while retaining "derived from" metadata for later inspection.

## Selective Execution Contract

Users need to rerun downstream utility work without spending credits or regenerating expensive upstream model outputs.

User-facing modes:
- `Enabled`: node runs normally.
- `Muted`: node reuses its latest valid output snapshot/artifacts and does not execute. This is the normal way to avoid rerunning expensive upstream model nodes while continuing downstream work.
- `Advanced: Bypass`: supported utility nodes pass compatible input through without creating a new derived artifact.
- `Disabled`: legacy/internal no-output mode for debugging and old workflows. New normal UI actions should not create this state.

Runtime storage:
- `metadata.execution.mode = "enabled"` for enabled nodes.
- User-facing `Muted` writes `metadata.execution.mode = "frozen"` so the existing cached-output runtime path is reused.
- Run-history pinning may also write `metadata.execution.cached_run_id` and `metadata.execution.cached_artifact_ids` so a Muted node reuses a specific previous run output instead of only the latest output.
- Advanced bypass writes `metadata.execution.mode = "bypassed"` only for nodes that declare compatible pass-through behavior.
- Legacy no-output disabled nodes remain readable as `metadata.execution.mode = "muted"`.

Validation rules:
- User-facing Muted nodes reuse cached output when it exists. If no cache exists and no enabled downstream input needs the muted node's output, the node skips cleanly instead of blocking the whole run.
- Muted nodes that feed required enabled downstream inputs must have a reusable cached output or pinned artifact set before Run.
- Pinned Muted nodes must reference an existing run output, existing graph artifacts when artifact ids are pinned, and still-existing media assets/reference media.
- Legacy Disabled nodes that feed required enabled downstream inputs should produce clear validation errors.
- Bypassed nodes must declare compatible pass-through ports; model nodes should not generic-bypass.
- If a Muted node's cached artifacts are missing from disk or deleted from the store, validation must fail before execution.
- Group-level execution mode applies to contained nodes unless a node explicitly overrides it.

Runtime rules:
- User-facing Muted nodes emit a cached-output event and publish cached outputs into the graph context.
- Bypassed nodes emit a bypass event and publish declared input refs to declared output ports.
- Legacy Disabled nodes emit a skipped event and publish no outputs.
- Enabled nodes continue through the existing validator, compiler, runtime, Media Studio service, and KIE paths.

## Node And Group UX Contract

Node context menu actions:
- Enable node
- Mute node / use latest output
- Advanced: Bypass, only when the node supports pass-through
- Legacy: Disable output, only when inspecting older no-output workflows or debugging
- Clear node
- Rename node
- Choose node color

Node visuals:
- `running`: green tracing border on only the active node
- `queued`: quiet pending state with no animation
- `completed`: subdued success border
- `failed`: thick red border and visible node-level error
- user-facing Muted/cached nodes: `Muted` chip and cool static border
- `bypassed`: dashed border and pass-through chip
- legacy Disabled/no-output nodes: dimmed node, inactive ports, no output preview update

Selection and grouping:
- Shift/Cmd/Ctrl-click continues to toggle node selection.
- Drag-select on empty canvas should select all nodes inside the selection rectangle.
- Delete removes selected nodes and connected edges.
- Group frames are visual workflow containers, not runtime nodes. The stored group bounds are the source of truth; membership is derived from node rectangles touching or overlapping those bounds.
- Dragging a group title moves the frame and all current member nodes together. A node dragged onto a group sticks as soon as its rectangle touches the group and remains a member until it is completely off the group.
- Group frames render as a background layer behind nodes plus a title/action layer above nodes, so nodes remain readable while the title stays draggable/right-clickable.
- Group frames should support title, color, node membership, collapse later, and group-level enable/mute.
- Group execution mode should be visible at the group frame and reflected on affected nodes.

## Next Production Slices

### Slice 1: Graph Artifacts, Grid Slice, Save-Many, And Selective Execution

Goal:
- Make derived media and partial reruns first-class so users can slice, resize, and save downstream outputs without rebuilding upstream model nodes.

Work:
- Add graph artifact persistence and lineage registration for model, utility, and save-node outputs.
- Add `image.grid_slice` with rows, columns, gutter handling, smart crop metadata, output format, and `image[]` output.
- Add `image.split` to fan out ordered `image[]` outputs into numbered image handles for per-slice branching.
- Add `media.save_images` to promote an `image[]` input into multiple gallery assets with group/project selection.
- Add node execution modes with simplified UI: Enabled, Muted cached-output reuse, Advanced Bypass, and legacy Disabled/no-output support.
- Add validation/compiler/runtime support for cached muted outputs, legacy disabled dependency failures, and supported bypass pass-through.
- Add frontend execution-mode controls, badges, chips, and node-state styling.
- Add drag-select multi-selection as the base for later group controls.

Acceptance:
- A 2x2 fixture image can be sliced into four derived reference-media artifacts.
- A split node can expose the four slices as `image_1` through `image_4` so each output can feed a different model/prompt branch.
- `media.save_images` saves all four slices as normal gallery assets in the selected group.
- Saved slice assets retain lineage back to the original grid image and slice node.
- A user-facing Muted model node reuses previous output and does not submit a new KIE job.
- Legacy Disabled required upstream nodes block Run with visible validation errors.
- Bypassed utility nodes pass compatible input through without producing new derived media.

### Slice 2: Multi-Select, Node Groups, And Group Execution Controls

Goal:
- Make complex workflows manageable by selecting, grouping, and controlling sets of nodes.

Work:
- Add selection rectangle drag on empty canvas.
- Add create group from selected nodes.
- Add group frame title, color, membership, and visual bounds.
- Add group-level enable, freeze, and mute controls.
- Store group metadata in workflow JSON without adding a separate workflow store.

Acceptance:
- Users can drag-select several nodes, group them, rename the group, color it, and mute/freeze the group.
- Group execution state affects runtime behavior without losing per-node override ability.
- Copy/paste and workflow import/export preserve group metadata.

### Slice 3: Run History, Artifact Browser, And Restore Previous Outputs

Goal:
- Let users inspect previous graph runs and reuse generated artifacts without guessing what happened.

Implemented foundation:
- Add run history panel for the active workflow.
- Show run status, events, metrics, errors, output artifacts, and saved assets.
- Let users restore a previous run snapshot into the canvas.
- Let users select artifacts from prior runs for load/freeze/reuse.
- Pin a node's user-facing Muted state to a selected run artifact through `cached_run_id` and `cached_artifact_ids`.

Remaining polish:
- Add download/open actions for artifacts and saved assets.
- Add richer artifact thumbnails in the browser panel.

Acceptance:
- Previous runs are visible after reload.
- A previous model output can be reused by freezing a node or selecting an artifact.
- Output previews restore from run history without rerunning the graph.

### Slice 4: Workflow Tabs And Template Browser

Goal:
- Make Graph Studio feel like a multi-workflow workspace.

Implemented foundation:
- Implement open workflow tabs from `docs/graph-studio-tabs-todo.md`.
- Add template save/load/instantiate with thumbnails.
- Add dirty-state tracking.
- Restore open tabs from browser session.
- Keep workflow CRUD backed by the existing graph workflow API.
- Preserve active run id and console lines in tab snapshots.

Remaining polish:
- Harden latest preview persistence per tab.
- Add final browser smoke for tabs plus templates together.

Acceptance:
- Multiple workflows can stay open.
- Closing one tab does not delete the saved workflow.
- Templates instantiate as editable workflows without mutating the template.
- Latest previews/settings survive tab switching and reload.

## V1 Readiness Matrix

| Area | Status | Release note |
| --- | --- | --- |
| Backend node definitions/runtime | Ready | Server-owned definitions, validation, compiler, runtime, events, and artifacts are in place. |
| Image workflows | Ready | Load/save, transform, grid slice, split, save-many, and lineage are covered. |
| Video workflows | Ready with final QA | Save/transcode/mux, transform/extract/combine, preview, and lineage exist; model-family browser smoke remains. |
| Audio workflows | Ready | Load/save/transform/mux contracts are implemented and browser-smoked with fixture reference audio/video. |
| Selective execution | Ready | User-facing Muted reuses cached output; run-history pinning can target a specific prior run artifact. |
| Run history/artifacts | Mostly ready | Listing, inspection, restore, and pinning exist; richer open/download UX remains. |
| Groups | Ready for v1 | Group frames can be created, dragged as containers, colored, renamed, muted/enabled, and persisted; collapse/resize remain v1.1. |
| Tabs/templates | Mostly ready | Tab foundation, session restore, templates, and close behavior exist; preview persistence needs final QA. |
| Interaction polish | Mostly ready | Low-zoom handle/resize hitboxes and wire snap tolerance are improved; continue visual QA during model-family smoke. |

### Slice 5: Full Model Family QA And Advanced Utility Nodes

Goal:
- Harden Graph Studio across all supported KIE model families and high-value utility workflows.

Work:
- Browser-smoke prompt-only image, image-to-image, image-to-video, video-to-video where supported, save image, and save video.
- Keep generated video model node definitions server-owned; infer video output from task modes such as `image_to_video` and `text_to_video` before trusting raw `media_types`.
- For two-frame image-to-video models, expose explicit `start_frame` and `end_frame` image inputs instead of a generic reference array; keep generic `image_refs` only for models that accept many unordered reference images.
- Use `media.save_video` as the gallery-promotion node for video outputs, with `source_original` as the default browser-safe path and bounded transcode presets as explicit options.
- For audio-aware video saves, keep `source_original` as the default and use explicit audio policy fields for replace, mix, or mute behavior. Mux operations must preserve poster/thumb generation and graph lineage.
- Add missing advanced utility nodes only when backed by clear tests and bounded execution.
- Verify pricing/validation remains server-canonical for generated model nodes.
- Add workflow export/import smoke for graphs containing model nodes, utility nodes, artifacts, and groups.

Acceptance:
- Supported model families render usable graph nodes from backend definitions.
- Unsupported workflow shapes are hidden from Graph Studio but diagnosable elsewhere.
- A release smoke suite covers the main graph patterns without spending live KIE credits by default.

## Code Quality Guardrails

The backend graph subsystem is already reasonably compartmentalized. Keep it that way.

Frontend risk:
- `apps/web/components/graph-studio/graph-studio.tsx` has been reduced below the Slice 0 target and should stay a thin shell. Workflow canvas hydration belongs in `utils/graph-workflow-hydration.ts`; new behavior should continue landing in hooks/components/utilities, not in the orchestrator.
- Do not add presets, utility nodes, tabs, and video chaining into that file directly.
- Group frames, run history, templates, and tab/session behavior now have focused modules. Keep extending those modules instead of reintroducing feature logic into `graph-studio.tsx`.

Target frontend layout:

```text
apps/web/components/graph-studio/
  graph-studio.tsx                 # thin orchestrator
  graph-node.tsx                   # generic node shell
  graph-toolbar.tsx
  graph-left-rail.tsx
  graph-workflow-menu.tsx
  graph-library-dialogs.tsx
  graph-console.tsx
  graph-preview-overlay.tsx
  graph-group-frame.tsx
  graph-run-history-panel.tsx
  graph-template-browser.tsx
  graph-studio-dialogs.tsx
  graph-connect-menu.tsx
  graph-canvas.tsx
  graph-library-dialogs.tsx
  hooks/
    use-graph-definitions.ts
    use-graph-workflows.ts
    use-graph-runs.ts
    use-graph-media-library.ts
    use-graph-connections.ts
    use-graph-session.ts
    use-graph-node-operations.ts
    use-graph-clipboard.ts
    use-graph-keyboard-shortcuts.ts
    use-graph-run-lifecycle.ts
    use-graph-run-history.ts
    use-graph-tabs.ts
    use-graph-templates.ts
    use-graph-groups.ts
    use-graph-workflow-actions.ts
    use-graph-workflow-transfer.ts
    use-graph-node-previews.ts
    use-graph-connections.ts
  utils/
    graph-node-factory.ts
    graph-edge-style.ts
    graph-workflow-serialization.ts
```

Backend target:

```text
apps/api/app/graph/
  registry.py
  validator.py
  compiler.py
  runtime.py
  routes.py
  executors/
    preset_ops.py
    image_ops.py
    video_ops.py
```

Release gates for every large Graph Studio slice:
- graph API unit tests
- relevant web tests
- `npm run typecheck:web`
- `npm run lint:web`
- local browser smoke through `/graph-studio`
- no browser console errors on the tested route
- no copied ComfyUI frontend code

## Clean-Room Reference Notes

ComfyUI frontend is useful as product/UX reference only. Media Studio should keep its own React implementation and backend-owned node contract.

Useful ideas to adapt, not copy:
- node library/search with filtering and categories
- link release opening compatible-node search
- workflow tabs and session restore
- bottom panel/console tabs
- dialog-based prompt/rename flows instead of browser prompts
- widget-to-input conversion for connectable fields
