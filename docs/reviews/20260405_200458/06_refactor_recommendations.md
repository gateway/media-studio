# Refactor Recommendations

## Quick wins
1. Extract a single `StudioMetricPill`
2. Extract Seedance attachment-intent resolution into the hook or a shared helper
3. Remove generated-file noise from feature diffs (`next-env.d.ts`)

## Controlled refactor
### Attachment intent adapter
- Create a helper that takes:
  - drop source type (`gallery_asset`, `picker`, `file_drop`)
  - destination (`source_slot`, `seedance_reference`)
  - slot index / kind
- Return:
  - accepted role
  - allowed kinds
  - early rejection message
- This reduces duplicated condition trees without changing queue or API behavior.
