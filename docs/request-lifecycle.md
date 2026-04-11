# Media Studio Request Lifecycle

This document describes the current request path from Studio compose through retry.

## 1. Compose

- The Studio composer collects:
  - model
  - task mode
  - prompt
  - options
  - staged source media
  - staged reference media
  - preset text values and preset image slots
  - selected system prompts

For Nano workflows, the UI may show an ordered reference-image rail, but the browser still submits a normalized request contract to the local API.

## 2. Validate

- The web app sends a normalized payload to the local FastAPI control API.
- The API builds a validation bundle in `apps/api/app/service.py`.
- The validation bundle contains:
  - raw request
  - prompt context
  - validation output
  - preflight output
  - pricing summary
  - resolved preset and system prompt state

## 3. Submit

- Only requests in a ready validation state are submitted.
- Submit persists:
  - batch metadata
  - per-job normalized request state
  - selected system prompt ids
  - resolved options
  - validation and preflight details

The persisted normalized request is the replay-safe source for retries and runner submission.

## 4. Optimistic Queue State

- The Studio UI creates optimistic batch and job cards immediately after submit.
- Jobs that fit in current runner capacity show as active.
- Remaining outputs show as queued.

This is a UI hint only. The control API remains the source of truth for actual job status.

## 5. Polling

- The embedded runner starts queued jobs when capacity is available.
- Active jobs are polled on the configured interval.
- Batch state is recomputed from underlying job states.
- Completed outputs are published into dashboard assets as soon as they are ready.

## 6. Publish

- Provider outputs are downloaded locally.
- Media Studio publishes derived asset records and local file paths for gallery display.
- The gallery reconciles completed assets with optimistic cards.

## 7. Retry

- Failed-job retry replays the original request shape instead of rebuilding a reduced request by hand.
- The backend retry path reconstructs `JobSubmitRequest` from:
  - stored normalized request data
  - persisted source asset id
  - persisted selected system prompt ids
  - stored batch request summary for preset text values and preset image slots
- Any source-asset and preset-slot refs already injected into the normalized image list are stripped before the request is rebuilt, so they are not duplicated on the second validation pass.

## 8. Reference Library Backfill

- Reference-library scans are not triggered implicitly by `GET /media/reference-media`.
- Existing uploads are added through an explicit backfill action instead.
- The backfill path:
  - scans `data/uploads`
  - hashes files using streaming reads
  - deduplicates by `(kind, sha256, file_size_bytes)`
  - logs a summary with timing

This keeps normal library open and list requests cheap and predictable.
