# Model Ingestion Hardening

## Summary

Harden Media Studio so new `kie-api` models are discovered automatically, classified safely, and only exposed in Studio when their input contract fits patterns the current UI actually supports.

Current policy choice:

- unknown or unsupported model shapes should be hidden from Studio until Media Studio explicitly supports them
- admin surfaces should still show them and explain why they are hidden
- KIE remains the source of truth for provider validation, payload building, pricing, and option values
- Studio can auto-render known option-control types from the API contract, but not new media-slot workflows

## Implementation Direction

### 1. Canonical compatibility classifier

The Media Studio API classifies each `kie-api` model spec and returns:

- `studio_exposed`
- `studio_support_status`
- `studio_supported_input_patterns`
- `studio_unsupported_input_patterns`
- `studio_unsupported_option_keys`
- `studio_hidden_reason`
- `studio_support_summary`
- `studio_dynamic_options`
- `kie_spec_version`

Supported v1 patterns:

- text to image
- image edit
- text to video
- image to video
- first/last frame
- motion control
- current Seedance-style multimodal reference flow

### 2. Dynamic option rendering

Composer controls come from `studio_dynamic_options` when present:

- `enum` options render as picker choices
- `bool` options render as true/false choices
- `int_range` options render as compact choices or a bounded numeric input
- `string` options are hidden unless KIE explicitly marks a text control with `ui_control: text`

The web-side classifier remains only a fallback for older API responses.

### 3. Gate Studio exposure safely

- Show only `studio_exposed` models in the main Studio composer picker
- Keep all discovered models visible in `/models`
- Clearly label unsupported models in admin with the hidden reason

### 4. Provider update workflow

When KIE adds higher resolutions, longer durations, new aspect ratios, or enum values that fit existing controls:

- update the KIE spec and pricing snapshot if needed
- sync packaged KIE specs
- start Media Studio against that KIE checkout
- verify `/media/models` includes the new `studio_dynamic_options` values
- verify `/media/pricing/estimate` prices the new option value
- browser-smoke `/models` and `/studio`

When KIE adds a new input pattern, media slot, task mode, or unsupported option type, keep the model visible in `/models` but hidden from the Studio composer until a workflow is implemented.

### 5. Operator verification

In `/models`, surface:

- discovered model list
- support status
- hidden/exposed state
- unsupported reason
- KIE spec fingerprint
- dynamic Studio options
- pricing coverage warnings

This should be the first place to check whether a new `kie-api` model is ready for Studio.

## Test Plan

- classifier tests for all currently supported pattern families
- classifier test for at least one unknown/new pattern
- API tests asserting new support metadata on model responses
- API tests asserting dynamic options include new KIE enum/range values
- web tests asserting unsupported models are hidden from the Studio picker
- admin tests asserting unsupported models remain visible in `/models`
- web tests asserting `studio_dynamic_options` drives composer defaults and option choices
- regression checks for existing supported models:
  - Nano Banana
  - Kling 2.6
  - Kling 3.0
  - Seedance

## Notes

- Dynamic model discovery from `kie-api` already exists
- The remaining risk is not discovery, but incorrect UI assumptions when a new model shape appears
- This task is intentionally Safe v1 and should not force a full spec-driven composer rewrite in the same slice
