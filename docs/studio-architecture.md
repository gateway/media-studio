# Studio Architecture

`MediaStudio` is being split into stable controller and view boundaries without changing the public route, payload, or queue behavior.

## Current split

- `apps/web/hooks/studio/use-studio-gallery-feed.ts`
  Owns gallery assets, optimistic batches, paging, filters, and duplicate-safe gallery reconciliation.
- `apps/web/hooks/studio/use-studio-selection.ts`
  Owns selected asset state, inspector/lightbox hydration, and selected asset derived views.
- `apps/web/hooks/studio/use-studio-polling.ts`
  Owns batch/job polling, retry/dismiss flows, favorite mutations, and route refresh coordination.
- `apps/web/hooks/studio/use-studio-composer.ts`
  Owns composer state, prompt and preset input state, prompt enhancement, validation, submit flows, attachment state, and floating composer banner behavior.

## View boundaries

- `apps/web/components/studio/studio-header-chrome.tsx`
  Gallery filters and header chrome.
- `apps/web/components/studio/studio-gallery.tsx`
  Gallery card rendering, progress cards, and card-level interactions.
- `apps/web/components/studio/studio-composer.tsx`
  Dock shell for the prompt composer, floating banner, metrics, and mobile expand/collapse framing.
- `apps/web/components/studio/studio-lightbox.tsx`
  Full-screen media preview.

## Remaining top-level responsibilities

`apps/web/components/media-studio.tsx` is now an orchestration layer. It still owns:

- router refresh wiring
- overlay lock behavior
- cross-controller handoff for source asset drag/drop
- selected asset inspector layout
- settings modal composition
- browser-specific download/share behavior

## Refactor rule

Further extraction should keep these unchanged:

- route names
- control API payloads
- polling cadence
- gallery ordering
- visible button text

## Verification

See [docs/studio-testing.md](/Users/evilone/Documents/Development/Video-Image-APIs/media-studio/docs/studio-testing.md) for the current Studio gates:

- fast quality gates
- release verification with browser smoke coverage
- provider-backed live smoke for real Nano/Kling runs
