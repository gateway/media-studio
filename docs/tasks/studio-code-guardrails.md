# Studio Code Guardrails

Use these guardrails for future Studio web changes so fixes do not keep inflating `media-studio.tsx` and adjacent restore flows.

## Guardrails

- Do not add a second render branch for the same user-visible action set.
  - If desktop and mobile need different placement, keep one shared action component and control placement with explicit props.
- When a behavior depends on saved job or asset shape, push that decision into a helper first.
  - Inspector preview rules belong in `media-studio-helpers.ts`.
  - Retry / create-revision restore rules belong in `studio-composer-restore.ts` plus helper functions.
- Prefer durable local media paths over transient provider upload URLs during restore flows.
  - Saved local file paths are the stable source of truth for revision recovery.
- If a fix introduces a new branch for `source_asset_id = null`, preset slots, or implicit request media, add a targeted unit test in the same slice.
- Do not bolt new visual shells directly into feature files when an existing primitive already covers the same structure.
  - Reuse the shared surface and action primitives first.
- When a component grows because of repeated conditional UI, split render-only sections before adding more stateful logic.

## Required Gates For Studio UI Slices

- `npm --workspace apps/web run test`
- `npm --workspace apps/web run typecheck`
- `npm --workspace apps/web run build`

## High-Risk Areas To Keep Small

- `apps/web/components/media-studio.tsx`
- `apps/web/components/studio/studio-composer-restore.ts`
- `apps/web/lib/media-studio-helpers.ts`
- `apps/web/hooks/studio/use-studio-composer.ts`

## Review Checklist

- Did this change duplicate an existing render path?
- Did this change prefer a helper or controller over another inline conditional branch?
- Did this change add or update the exact unit test for the new data shape?
- Did this change reuse existing primitives and shared styles instead of adding one-off visual shells?
