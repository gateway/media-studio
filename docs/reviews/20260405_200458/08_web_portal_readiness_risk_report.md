# Web Portal Readiness Risk Report

## Summary
The Seedance integration is close to portal-ready for internal use. The biggest remaining risk is not backend correctness; it is UI-path correctness drift between drag/drop surfaces.

## Current readiness
- Shared composer shell: good
- Seedance reference panel: good
- Gallery image/video drag-to-reference: working
- File-input reference staging: working
- Browser smoke for no-submit validation: updated and aligned

## Risks
### Medium
- Local file drop onto Seedance frame slots can still create the wrong role in the prompt-only state.

### Low
- Theme duplication (`StudioMetricPill`) increases the chance of subtle visual drift.
- The review branch still includes generated file churn (`next-env.d.ts`).

## Ship call
- Safe to continue internal testing with risk.
- Fix the frame-slot file-drop bug before calling this RC-clean.
