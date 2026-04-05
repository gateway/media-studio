# Scalability Readiness Checklist

## Good
- Shared composer shell remains intact
- Seedance references are kept outside the main composer body, which limits layout churn
- Gallery drag/drop now supports non-image assets

## Watch items
- Large `media-studio.tsx` surface still carries orchestration plus drop-zone specifics
- More multimodal models will increase pressure on the current event-routing approach
- Shared `isDragActive` state can become visually noisy as more drop targets are added
