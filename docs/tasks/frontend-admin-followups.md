# Frontend Admin Follow-Ups

This file tracks the remaining frontend cleanup work after the admin-only shared-surface pass.

## Done In This Pass

- Collapsed `admin-controls` inset helpers onto shared surface primitives.
- Moved repeated admin callout and inset usage onto shared primitives in:
  - `apps/web/app/pricing/page.tsx`
  - `apps/web/app/jobs/page.tsx`
  - `apps/web/app/jobs/jobs-batch-card.tsx`
  - `apps/web/app/jobs/runtime-controls.tsx`
  - `apps/web/app/setup/page.tsx`
  - `apps/web/components/media-models-console.tsx`

## Remaining Cleanup Targets

### 1. Finish admin page primitive adoption

- `apps/web/components/studio-debug-settings.tsx`
  - Replace remaining raw `admin-surface-inset` wrappers with `SurfaceInset` or `CalloutPanel`.
- `apps/web/components/media-models-console.tsx`
  - Audit remaining `admin-code-block`, `admin-row-surface`, and custom property-grid usage.
  - Decide whether the admin property grid should stay local or become a shared primitive.
- `apps/web/components/panel.tsx`
  - Confirm `PanelHeader` remains sufficient, or merge some admin-specific title/description spacing into a shared header primitive.

### 2. Tighten token and alias usage

- Remove any compatibility alias in `apps/web/app/globals.css` that no longer has more than one real consumer.
- Recheck `admin-surface-dashed`, `admin-row-surface`, and `admin-code-block`.
- If an alias is still needed, keep the `compatibility alias` comment above it.

### 3. Normalize admin input chrome

- Audit `AdminInput`, `AdminTextarea`, and select trigger usage across:
  - `media-models-console.tsx`
  - `media-preset-editor-screen.tsx`
  - `media-prompts-console.tsx`
- Decide whether more of the admin form chrome should route through `SurfaceInputShell` instead of staying in local class strings.

### 4. Studio-side cleanup still pending

- `apps/web/components/media-studio.tsx`
  - Still carries a lot of render orchestration and local class clusters.
- `apps/web/components/studio/`
  - Audit remaining slot, inspector, and lightbox visual shells that do not yet use the shared primitive layer.
- Keep this as a separate pass from admin so regressions are easier to isolate.

## Verification Checklist

Run after each follow-up slice:

- `npm --workspace apps/web run test`
- `npm --workspace apps/web run typecheck`
- `npm --workspace apps/web run build`

Manual admin checks:

- `/models`
  - model select
  - queue controls
  - model availability toggles
- `/settings`
  - enhancement provider forms
  - queue settings
  - output path / debug blocks
- `/pricing`
  - top catalog summary
  - rule cards
  - scenario rows
- `/jobs`
  - runner health
  - runtime controls
  - failed job callouts
  - paging controls
- `/setup`
  - readiness cards
  - onboarding command blocks
  - step cards

Acceptance checks:

- no console errors on visited admin pages
- no visual regressions in card spacing, inset hierarchy, or callout tones
- no duplicate visual shell remains in admin when a shared primitive already exists
