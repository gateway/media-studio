# API Exposure Matrix

## Reviewed routes
- `POST /api/control/media` (validate/submit path used by the composer and smoke)
- `GET /api/control/media-assets` (gallery data used for drag/drop verification)

## Observations
- The updated Seedance smoke now aligns with the current contract by validating via `intent=validate` without generating a queued job.
- The smoke no longer depends on removed Seedance mode buttons or removed token panels.

## Gaps
- The committed smoke still focuses on file-input staging, not real gallery drag/drop or Finder-style dropped video files with empty MIME.
- Those paths were manually verified during review, but they are not yet represented in the committed smoke coverage.
