# Security Posture Assessment

## Scope
Seedance composer, gallery drag/drop, and no-submit browser smoke.

## Result
No critical or high-severity security issues were identified in the reviewed diff.

## Observations
- Gallery drag/drop uses an internal asset id (`application/x-bumblebee-media-asset-id`) and then resolves the asset from local/favorite state before staging.
- Seedance reference targets enforce kind checks when staging gallery assets through `addGalleryAssetAsAttachment(..., allowedKinds)`.
- File-drop classification now handles video/audio extension fallback in `apps/web/lib/media-studio-helpers.ts:501-507`, which reduces accidental misclassification.

## Remaining Risks
### Medium: UI-side drag path can still create unintended request shape
- Evidence:
  - `apps/web/components/media-studio.tsx:1036-1083`
- This is primarily a correctness issue, but it can also weaken trust in client-side validation because the UI accepts a drop into a frame slot and silently stages it as a reference when the mode is still prompt-only.
- Fix:
  - assign role by slot index for local file drops on Seedance source slots, not by inferred mode alone

## Recommendations
- Treat the client as advisory and keep `kie-api` validation authoritative
- Add explicit browser coverage for real gallery drag and local file drop on Seedance frame slots
