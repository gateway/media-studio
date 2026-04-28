# Studio Architecture

`MediaStudio` is being split into stable controller and view boundaries without changing the public route, payload, or queue behavior.

## Current split

- `apps/web/hooks/studio/use-studio-gallery-feed.ts`
  Owns gallery assets, optimistic batches, paging, filters, and duplicate-safe gallery reconciliation.
- `apps/web/hooks/studio/use-studio-selection.ts`
  Owns selected asset state, inspector/lightbox hydration, and selected asset derived views.
- `apps/web/hooks/studio/use-studio-polling.ts`
  Owns batch/job polling, retry/dismiss flows, favorite mutations, and route refresh coordination.
- `apps/web/hooks/studio/use-studio-composer.ts`
  Owns composer state, prompt and preset input state, prompt enhancement, validation, submit flows, attachment state, and floating composer banner behavior.

## View boundaries

- `apps/web/components/studio/studio-header-chrome.tsx`
  Gallery filters and header chrome.
- `apps/web/components/studio/studio-gallery.tsx`
  Gallery card rendering, progress cards, and card-level interactions.
- `apps/web/components/studio/studio-composer.tsx`
  Dock shell for the prompt composer, floating banner, metrics, and mobile expand/collapse framing.
- `apps/web/components/studio/studio-lightbox.tsx`
  Full-screen media preview.
- `apps/web/components/studio/studio-composer-restore.ts`
  Shared restore controller for failed-job retry and completed-asset revision flows.
- `apps/web/components/studio/selected-asset-prompt-panel-content.tsx`
  Shared selected-asset prompt and preset-details body used by both desktop and mobile inspector wrappers.
- `apps/web/components/studio/studio-standard-slot-rail.tsx`
  Shared explicit slot renderer for standard slot-contract models across desktop and mobile.
- `apps/web/components/ui/surface-primitives.tsx`
  Shared Studio/admin presentation primitives. Use these for repeated shells and rows before adding more feature-local visual class strings.

## Remaining top-level responsibilities

`apps/web/components/media-studio.tsx` is now an orchestration layer. It still owns:

- router refresh wiring
- overlay lock behavior
- cross-controller handoff for source asset drag/drop
- selected asset inspector layout
- settings modal composition
- browser-specific download/share behavior
- controller wiring between gallery, selection, polling, composer, and restore helpers

## Seedance 2.0 contract

Seedance is the first Studio model with a split multimodal surface:

- `Start frame` and `End frame` stay inside the shared composer source strip
- reference media stays outside the composer in a dedicated reference strip
- reference media kinds supported in Studio:
  - images: `9` max
  - videos: `3` max
  - audio: `3` max

Current interaction rules:

- dropping or picking a file in `Start frame` stages `first_frame`
- dropping or picking a file in `End frame` stages `last_frame`
- `End frame` is rejected until a `Start frame` exists
- gallery image/video cards can be dragged into the matching Seedance reference panel
- Seedance reference panels also accept local file drop and file picker input

The server-side authority for validation remains `kie-api`; Studio should only shape the request correctly and surface the resulting validation clearly.

## Standard composer slot contract

Non-Seedance, non-Nano standard models now use one shared explicit slot contract instead of branching separately for:

- single-image flows
- first-and-last-frame flows
- motion-control flows

The contract lives in:

- `apps/web/lib/media-studio-helpers.ts`
  - `resolveStandardComposerSlots(...)`

The renderer consumes that contract in:

- `apps/web/components/studio/studio-standard-slot-rail.tsx`

The controller/hook keeps slot staging and replacement behavior coherent in:

- `apps/web/hooks/studio/use-studio-composer.ts`
- `apps/web/lib/studio-attachment-staging.ts`

## Restore path

Retry and revision now share one internal restore controller:

- `apps/web/components/studio/studio-composer-restore.ts`

That controller owns:

- project context handoff before restore
- implicit primary-input fallback from normalized request payloads
- preset slot file restore
- reference reattachment fallback
- non-blocking partial restore behavior when some media cannot be refetched

`MediaStudio` only decides when to invoke restore and what success/failure copy to show.

For the concrete rules, slot types, replacement semantics, and verification path, see [docs/studio-standard-composer-slots.md](docs/studio-standard-composer-slots.md).

For structured preset records, text placeholders, image slots, import/export, and retry/revision restore behavior, see [docs/studio-preset-system.md](docs/studio-preset-system.md).

For the current implementation ownership map after the monolith-reduction pass, see [docs/studio-implementation-map.md](docs/studio-implementation-map.md).

## Refactor rule

Further extraction should keep these unchanged:

- route names
- control API payloads
- polling cadence
- gallery ordering
- visible button text

## Frontend styling rule

- Keep layout-only utilities such as `flex`, `grid`, `gap`, and breakpoint classes inline when they are local and obvious.
- Move repeated visual treatments into shared primitives or semantic classes:
  - cards
  - insets
  - info rows
  - overlay shells
  - preview frames
  - empty states
- Do not reintroduce parallel Studio/admin token families for the same semantic role when a shared UI token can be overridden by appearance.

## Verification

See [docs/studio-testing.md](docs/studio-testing.md) for the current Studio gates:

- fast quality gates
- deterministic release verification
- local-only smoke guidance for developer-owned browser and provider checks

For the full submit, queue, publish, retry, and reference-library backfill lifecycle, see [docs/request-lifecycle.md](docs/request-lifecycle.md).
