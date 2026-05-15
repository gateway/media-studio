# Graph Studio Node Authoring Guide

This is the implementation contract for adding or changing Graph Studio nodes. Graph Studio nodes are backend-owned: the API defines the node shape, validation, execution, pricing, help, and media behavior; the web app renders that contract.

Use this guide before accepting a complex node idea.

## First Decision

Classify the node before writing code:

- Static system node: add it to the matching `apps/api/app/graph/system_nodes_<family>.py` module. Keep `system_nodes.py` as an aggregator only.
- Generated KIE/model node: update model metadata and the generator in `apps/api/app/graph/registry.py`. Do not hard-code model-only behavior in the frontend.
- Dynamic preset node: update preset rendering and dynamic definition paths, not a one-off static node.
- Runtime utility node: add a backend definition plus a focused executor under `apps/api/app/graph/executors/`.
- UI-only helper: avoid this unless it is strictly presentation. If it affects workflow JSON, run output, media refs, pricing, validation, or execution, it is not UI-only.

If the node touches assets, reference media, artifacts, lineage, cached outputs, pricing, or DB rows, trace upstream/downstream behavior before editing.

## Definition Shape

Every node definition is a `GraphNodeDefinition` from `apps/api/app/graph/schemas.py`.

Required shape:

```python
GraphNodeDefinition(
    type="family.action",
    title="Readable Title",
    description="One sentence purpose.",
    help_text="Optional short help if description is not enough.",
    category="Media",
    search_aliases=["short", "search", "terms"],
    tags=["media", "image"],
    source={"kind": "system"},
    execution={"executor": "family.action", "mode": "sync", "cacheable": True, "output_node": False},
    limits={},
    ui={
        "default_size": {"width": 320, "height": 260},
        "min_size": {"width": 260, "height": 180},
        "max_size": {"width": 720, "height": 760},
        "color": "image",
        "accent": "green",
        "icon": "image",
        "preview": False,
        "field_layout": "stack",
    },
    ports={"inputs": [], "outputs": []},
    fields=[],
)
```

Validation currently enforces supported port types, visible field renderers, unique ids, known UI tokens, and `ui.min_size/default_size/max_size`.

## Ports

Supported port types:

- `image`
- `video`
- `audio`
- `text`
- `json`
- `asset`
- `reference_media`
- `job`
- `any`

Do not add `tensor` or `latent` until Media Studio has a real local ML runtime that can execute them.

Port fields:

- `id`: stable id used in workflow edges. Do not rename shipped ids without migration.
- `label`: short visible label.
- `type`: value type.
- `array`: allows multiple incoming edges for inputs or multiple values for outputs.
- `min`: minimum expected connected values for array ports.
- `max`: maximum accepted values.
- `required`: validation fails if unresolved.
- `accepts`: compatible source types when broader than `type`; leave empty when exact type is enough.
- `description`: short help text used by help popovers.
- `advanced`: hidden from the normal node UI unless a node-specific dynamic renderer exposes it.

Rules:

- Outputs connect only to inputs. Keep handle ids canonical through `out:<port>` and `in:<port>` on the frontend; workflow JSON stores raw `source_port` and `target_port`.
- Single-value inputs are the default. Leave `array=False` and set `max=1` when an input should accept only one incoming edge; backend validation also rejects multiple edges for any non-array input.
- Use `array=True` only for intentional fan-in or fan-out data, such as model `image_refs`, `video_refs`, `audio_refs`, `image[]`, or `asset[]`, and always set a meaningful `max`.
- Use explicit numbered ports only when ordering matters, such as `video_1` through `video_12`.
- For single-value required media inputs, use `required=True`, `min=1`, and `max=1`.
- For optional refs, keep `required=False` and let backend validation decide based on mode fields.
- For multi-reference model inputs such as `image_refs`, `video_refs`, or `audio_refs`, the edge order into the target array port is the user-visible reference order. The UI may show computed badges on the source load nodes, such as `image reference 1`, but those badges must be derived from edges and node definitions rather than stored as node fields.
- Keep provider payload assembly aligned with the same reference order so prompt tokens like `[image reference 1]` match the actual uploaded media order.

## Fields

Supported visible field types:

- `text`
- `textarea`
- `select`
- `enum`
- `boolean` / `bool`
- `integer` / `number` / `float`
- `int_range` / `float_range`
- `timecode`
- `color`
- `asset_picker`
- `reference_media_picker`
- `preset_picker`

Field options:

- `required`: validation and UI indicator.
- `default`: used for new nodes and field visibility fallback.
- `placeholder`: compact input hint.
- `options`: select/enum options. Prefer objects with `label` and `value` for user-facing labels.
- `min` / `max`: numeric bounds.
- `help_text`: short control help. Required for non-obvious fields.
- `advanced`: keep out of normal surfaces unless needed.
- `hidden`: present in workflow/runtime but not rendered.
- `connectable` / `port_type`: mark that a field can be driven by an upstream wire.
- `visible_if`: dynamic visibility. Supported keys are `equals`, `not_equals`, `in`, and `not_in` against another field.

Connectable field rule:

- If a field should accept a wire, add a matching input port with the same id as the field. The generic renderer attaches that input handle beside the field and disables the field once connected.
- If a field only matters when a specific input is connected, add `ui.connection_dependent_fields = {"field_id": "input_port_id"}` to the node definition. The frontend hides that field until the matching input has an edge. `prompt.text` uses this so `Mode` only appears when the `text` input is wired.

Example:

```python
GraphNodePort(id="prompt", label="Prompt", type="text", required=True, description="Prompt text for the model."),
GraphNodeField(id="prompt", label="Prompt", type="textarea", required=True, connectable=True, port_type="text", help_text="Can be typed here or connected from a Prompt Text node."),
```

## UI Metadata

Use existing UI tokens before adding new colors/icons:

- color/accent/icon tokens include `image`, `video`, `audio`, `text`, `json`, `asset`, `preset`, `save`, `debug`, `info`, `green`, `blue`, `cyan`, `purple`, `orange`, `yellow`, and hex colors accepted by the validator.
- `ui.preview=True` reserves preview space. Use it for media load/save/preview nodes, not for every model node.
- `default_size`, `min_size`, and `max_size` must leave enough room for required fields, previews, ports, and header chips.
- Do not add frontend special cases for sizing unless the generic metadata cannot express the node.

## Media Handling

Graph Studio media values should be ids and metadata, not raw bytes:

- Gallery assets use `asset_id`.
- Reference media uses `reference_id`.
- Runtime output uses `GraphOutputRef` with `kind`, `media_type`, ids, and metadata.
- Workflow JSON must not contain base64, absolute paths, secrets, or raw provider payloads.
- Intermediate transforms should generally create reference media first; save nodes promote outputs into normal gallery assets.
- Save nodes should record graph lineage and artifacts so run history can restore/pin outputs.

Media node rules:

- Load nodes accept existing gallery assets or reference media and output typed media refs.
- Preview nodes pass through media refs and should not create gallery assets.
- Transform/combine/extract nodes create derived reference media and graph artifacts.
- Save nodes create gallery assets, posters/thumbs where relevant, and lineage metadata.
- Audio/video operations must enforce size/duration limits and use ffmpeg/ffprobe with `shell=False`.
- File paths must stay data-root bounded.

Current important limits:

- Audio graph inputs: 100 MB max, 10 minutes max.
- Image utilities: max 4096 px source dimension unless a stricter node limit applies.
- Grid/split fan-out: max 25 outputs.
- Video combine: max 12 clip inputs.

## Execution

`execution.executor` selects backend runtime behavior. The executor should:

- validate required resolved inputs and mode-specific requirements before doing expensive work
- return typed `GraphOutputRef` values keyed by output port
- write artifacts for restorable media outputs
- preserve lineage metadata for saved assets/reference media
- be deterministic/cacheable when safe
- avoid direct frontend/provider calls
- avoid `shell=True`

Execution modes:

- `enabled`: run normally.
- user-facing `Muted`: internal `metadata.execution.mode = "frozen"`; reuse cached output and do not resubmit model jobs.
- `bypassed`: advanced utility-only pass-through when declared by the node.
- legacy `muted`: disabled/no-output behavior for old workflows/debugging only.

If a node can be frozen, validation must fail before execution when pinned artifacts, asset ids, or reference media ids are missing.

## Pricing

Pricing is server-canonical.

- Model estimates come from `POST /media/graph/estimate`.
- Reuse existing KIE pricing math and freshness metadata.
- Utility nodes do not add KIE spend by themselves.
- Downstream model branches are summed independently.
- Unknown pricing must surface as unknown/warning, never zero.
- Stale pricing must propagate warning metadata.
- Frozen model nodes estimate zero new spend unless re-enabled.

Frontend rules:

- Node headers render the server estimate returned for that node.
- Toolbar renders graph totals and warnings.
- Confirmation is required only for over-credit or unknown-cost estimates.

## Help Text

Help is definition-driven:

- node `description`
- optional node `help_text`
- port `description`
- field `help_text`
- model `source` and `limits`

For KIE/model nodes, metadata must be rich enough to generate compact help for:

- required prompt/media inputs
- max image/video/audio refs
- output type/count
- aspect ratio, resolution, duration, format, sound, quality, or other key options
- cost estimate caveat

Do not put provider-specific help strings in the frontend if the backend definition does not expose the underlying fact.

## System Prompt Presets

Reusable LLM system prompts should be data-backed and selected by nodes, not copied into frontend constants.

Use the existing Media Studio system prompt store when a node needs reusable director or rewrite instructions:

- `key` and `label` identify the prompt in UI.
- `content` stores the actual system prompt.
- `role_tag` and category/task metadata should make prompts filterable for image directors, video directors, image description, prompt rewrite, grid-to-prompts, and similar graph roles.
- Node definitions may add a preset picker field only after the backend can validate and resolve the selected prompt id/key during execution.
- Workflow JSON should store only the selected prompt id/key and any local override text. Do not persist provider payloads, API keys, or raw model responses as node definitions.
- `prompt.llm` should remain the first consumer: system prompt preset, optional user prompt text, optional media inputs, and typed text output.

## Frontend Contract

The generic renderer should handle the node from definition metadata.

Add frontend behavior only when:

- the workflow interaction cannot be represented by existing fields/ports
- the behavior is reusable across multiple nodes
- the code lives in focused hooks/components/utilities, not `graph-studio.tsx`

Keep `apps/web/components/graph-studio/graph-studio.tsx` under 1200 lines.

CSS rules:

- `apps/web/app/graph-studio/graph-studio.css` is an import hub.
- Add styles to the matching file under `apps/web/app/graph-studio/styles/`.
- Use `.graph-studio-shell` tokens before adding raw colors/borders/radii.
- Preserve graph layering: group fill behind nodes, group title above nodes, wires below node bodies, popovers above graph content.

## Tests

Minimum targeted API tests for new nodes:

- definition validates and appears in `/media/graph/node-definitions`
- ports/fields/limits/help/pricing metadata match the intended contract
- validation rejects missing required inputs and incompatible media
- executor produces typed outputs and artifacts
- saved assets/reference media have lineage where applicable
- frozen/muted nodes reuse cached output and do not resubmit jobs
- missing pinned artifacts fail before execution
- graph estimate handles known, unknown, stale, and frozen pricing paths when models are involved

Minimum web tests:

- node search finds the node by title, type, category, aliases, and compatible-port filters
- generic renderer shows fields, dynamic fields, ports, help, price chips, and previews correctly
- copy/paste/import/export preserves fields, dimensions, execution metadata, and groups where relevant
- wire snapping accepts compatible inputs and rejects outputs/incompatible ports
- node sizing prevents required controls/previews from clipping

Browser smoke:

- reload `/graph-studio` with no console errors
- add the node from search
- connect representative upstream/downstream nodes
- verify help popover and dynamic fields
- run an offline/mocked path when possible
- save/reload from Workflows, not just browser session restore
- verify gallery/run-history/artifact restore paths when media outputs are involved

Standard gates:

```bash
./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py apps/api/tests/test_api_smoke.py -q
npm --workspace apps/web run test
npm run typecheck:web
npm run lint:web
git diff --check
wc -l apps/web/components/graph-studio/graph-studio.tsx
```

Live KIE credit-spending tests remain manual and require action-time approval.
