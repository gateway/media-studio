# Phased Remediation Plan

## Fix now
1. Correct Seedance frame-slot file-drop behavior
- Owner: web
- Files:
  - `apps/web/components/media-studio.tsx`
  - `apps/web/hooks/studio/use-studio-composer.ts`
- Validation:
  - browser test for dropping a local file onto start frame while prompt-only
  - browser test for rejecting end frame before start frame on file drop

2. Add committed browser coverage for real drag paths
- Owner: web
- Files:
  - `scripts/studio_browser_seedance_smoke.mjs`
- Validation:
  - gallery image -> `Image refs`
  - gallery video -> `Video refs`
  - dropped `.mp4` with empty MIME -> `Video refs`

## Fix next
3. Consolidate attachment-intent routing
- Owner: web
- Goal: reduce view/hook divergence for role assignment and kind filtering

4. Extract shared theme primitives
- Owner: web
- Goal: remove duplicated `StudioMetricPill`

## Backlog
5. Per-drop-zone drag-active state
- Goal: avoid global drag highlight coupling as more multimodal models land

6. Seedance user-facing docs
- Goal: document first/end frame rules, reference limits, and drag/drop support
