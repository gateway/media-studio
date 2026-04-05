# Dependency Graph Analysis

## Main flow
- `media-studio.tsx`
  - orchestrates UI composition, drag/drop adapters, and selected-asset interactions
- `use-studio-composer.ts`
  - owns attachment state, validation submission, attachment classification, and gallery asset staging
- `media-studio-helpers.ts`
  - owns file classification and input-pattern inference
- `studio-gallery.tsx`
  - owns gallery card rendering and drag source enablement
- `studio-composer.tsx`
  - owns the shared shell and floating banner placement

## Risk hotspots
- `media-studio.tsx` and `use-studio-composer.ts` now share responsibility for attachment intent
- the drag/drop contract is correct only when the view and hook remain synchronized
