# Model Ingestion Hardening

## Summary

Harden Media Studio so new `kie-api` models are discovered automatically, classified safely, and only exposed in Studio when their input contract fits patterns the current UI actually supports.

Current policy choice:

- unknown or unsupported model shapes should be hidden from Studio until Media Studio explicitly supports them
- admin surfaces should still show them and explain why they are hidden
- scope is a Safe v1, not a full composer rewrite

## Implementation Direction

### 1. Add a canonical compatibility classifier

Create one shared model-classification layer that takes a `kie-api` model spec and returns:

- support status
- recognized input pattern(s)
- unsupported reason(s)
- whether the model is safe to expose in Studio

Supported v1 patterns:

- text to image
- image edit
- text to video
- image to video
- first/last frame
- motion control
- current Seedance-style multimodal reference flow

### 2. Extend model payloads with Studio support metadata

Add additive support metadata to `/media/models` and `/media/models/{model_key}` such as:

- `studio_support_status`
- `studio_supported_input_patterns`
- `studio_hidden_reason`
- `studio_exposed`

Mirror those fields into the web model types and mapping layer.

### 3. Gate Studio exposure safely

- Show only `studio_exposed` models in the main Studio composer picker
- Keep all discovered models visible in `/models`
- Clearly label unsupported models in admin with the hidden reason

### 4. Reduce hardcoded UI assumptions

Route Studio composer behavior through the classifier and normalized pattern set instead of relying on scattered model-key heuristics.

Keep existing special flows like Seedance intact for now, but classify them explicitly through the same support system.

### 5. Add operator verification

In `/models`, surface:

- discovered model list
- support status
- hidden/exposed state
- unsupported reason

This should be the first place to check whether a new `kie-api` model is ready for Studio.

## Test Plan

- classifier tests for all currently supported pattern families
- classifier test for at least one unknown/new pattern
- API tests asserting new support metadata on model responses
- web tests asserting unsupported models are hidden from the Studio picker
- admin tests asserting unsupported models remain visible in `/models`
- regression checks for existing supported models:
  - Nano Banana
  - Kling 2.6
  - Kling 3.0
  - Seedance

## Notes

- Dynamic model discovery from `kie-api` already exists
- The remaining risk is not discovery, but incorrect UI assumptions when a new model shape appears
- This task is intentionally Safe v1 and should not force a full spec-driven composer rewrite in the same slice
