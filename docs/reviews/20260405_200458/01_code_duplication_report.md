# Code Duplication Report

## Scope
Reviewed the Seedance-related Studio changes in:
- `apps/web/components/media-studio.tsx`
- `apps/web/components/studio/studio-composer.tsx`
- `apps/web/components/studio/studio-gallery.tsx`
- `apps/web/hooks/studio/use-studio-composer.ts`
- `apps/web/lib/media-studio-helpers.ts`
- `scripts/studio_browser_seedance_smoke.mjs`

## Findings

### Medium: shared drag/drop logic is split across multiple surfaces
- Evidence:
  - `apps/web/components/media-studio.tsx:1036-1101`
  - `apps/web/hooks/studio/use-studio-composer.ts:520-675`
- The rules for source-slot drop, Seedance reference drop, gallery asset staging, and file classification are spread across the view component and the hook. This is not yet broken everywhere, but it already caused one real drift: prompt-only file drops on Seedance frame slots do not mirror the role assignment used for gallery-asset drops.
- Safe cleanup:
  - introduce a single attachment-intent helper that accepts `target=source_slot|seedance_reference`, `slotIndex`, and `source=gallery|file_drop|picker`
  - keep the hook as the owner of acceptance, role assignment, and limit enforcement
  - keep `media-studio.tsx` as the DOM event adapter only

### Low: theming duplication for metric pills
- Evidence:
  - `apps/web/components/media-studio.tsx:134-163`
  - `apps/web/components/studio/studio-composer.tsx:8-37`
- `StudioMetricPill` is duplicated with effectively the same implementation and tokens in two files.
- Safe cleanup:
  - extract one shared `StudioMetricPill` component under `apps/web/components/studio/`
  - move the color/border tokens with it so future theme passes only touch one place

### Low: generated file churn is sitting in the working tree
- Evidence:
  - `apps/web/next-env.d.ts`
- `next-env.d.ts` changed from the dev route types path to the build route types path. This is generated output, not feature logic.
- Safe cleanup:
  - regenerate in the intended mode before commit and avoid treating this file as feature code
  - if the repo intentionally tracks it, document which command owns the canonical version
