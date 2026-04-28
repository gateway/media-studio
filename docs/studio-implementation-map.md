# Studio Implementation Map

This document describes the current internal ownership after the Studio monolith-reduction pass.

## Web entrypoints

- `apps/web/components/media-studio.tsx`
  Top-level Studio orchestrator. It wires gallery, selection, polling, composer, project context, inspector overlays, and browser-specific affordances.
- `apps/web/components/media-models-console.tsx`
  Admin-facing model settings surface. It now delegates network persistence helpers to `apps/web/lib/media-model-admin.ts` and stays focused on page composition and form state.
- `apps/web/components/ui/surface-primitives.tsx`
  Shared visual shell primitives for Studio/admin cards, insets, info rows, section headers, overlays, and empty states.

## Composer ownership

- `apps/web/hooks/studio/use-studio-composer.ts`
  Primary composer controller for prompt, options, preset inputs, staged media, validation, enhancement preview, and submit behavior.
- `apps/web/lib/studio-attachment-staging.ts`
  Shared attachment materialization and insert/replace semantics used by live add, restore add, and reference-library attachment staging.
- `apps/web/components/studio/studio-composer-restore.ts`
  Shared restore controller used by:
  - failed job `Retry in Studio`
  - completed asset `Create Revision`

For the structured preset contract, placeholder syntax, image-slot payloads, import/export behavior, and preset restore flow, see [docs/studio-preset-system.md](docs/studio-preset-system.md).

## Selected asset inspector

- `apps/web/components/studio/studio-inspector-info.tsx`
  Asset metadata, reference previews, and project link surface.
- `apps/web/components/studio/studio-inspector-actions.tsx`
  Action buttons for revise, animate, use image, download, and dismiss.
- `apps/web/components/studio/selected-asset-prompt-panel-content.tsx`
  Shared prompt and preset-details body rendered inside both desktop and mobile wrappers.

## Slot rendering

- `apps/web/lib/media-studio-helpers.ts`
  Computes the standard slot contract via `resolveStandardComposerSlots(...)`.
- `apps/web/components/studio/studio-standard-slot-rail.tsx`
  Renders the explicit slot rail for standard models on desktop and mobile.

## Admin persistence

- `apps/web/lib/media-model-admin.ts`
  Shared request helpers and upsert utilities for:
  - enhancement provider save
  - enhancement provider probe
  - queue settings save
  - per-model queue policy save
  - output-folder open action

## Verification surface

- `apps/web/lib/studio-composer-restore.test.ts`
  Covers completed-asset revision and retry restore controller behavior.
- `apps/web/lib/studio-attachment-staging.test.ts`
  Covers ordered image insert and replace semantics.
- `apps/web/lib/media-studio-helpers.test.ts`
  Covers standard slot contracts, enhancement preview helpers, retry planning, and staged-media derivation.

## Refactor rule

Further cleanup should preserve:

- route names
- control API payloads
- queue semantics
- model visibility behavior
- visible user-facing copy unless the task is explicitly product copy

Comment-worthy invariants now belong in the extracted helpers and controller boundaries above. Keep `media-studio.tsx` focused on orchestration instead of re-inlining restore, staging, or admin request rules.

Visual cleanup should follow the same rule: keep one-off layout utilities inline, but move repeated shells, rows, overlays, and preview frames into shared primitives or semantic classes instead of duplicating raw arbitrary-value Tailwind strings.
