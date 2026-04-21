# Standard Composer Slots

This document describes the explicit slot system used by the standard Studio composer path.

Scope:

- applies to non-Seedance, non-Nano standard models
- currently covers:
  - prompt-only models
  - single-image / image-edit models
  - first-and-last-frame models
  - motion-control models

Out of scope:

- `seedance-2.0`
- `nano-banana-2`
- `nano-banana-pro`
- structured Nano presets and Seedance reference rails

## Why This Exists

The old standard composer path had too many boolean branches:

- `explicitVideoImageSlots`
- `explicitMotionControlSlots`
- generic attachment strip logic
- slot-count summary cards

That made the UI drift from the real model contract. It also made replacement, drag/drop, and optional-slot visibility harder to reason about.

The current system replaces those branches with one shared slot contract resolver:

- `apps/web/lib/media-studio-helpers.ts`
  - `resolveStandardComposerSlots(...)`

The renderer now consumes that contract instead of inventing layout model-by-model.

## Contract Shape

Each slot is represented by `StudioComposerSlot`:

- `id`
- `kind`
  - `image`
  - `video`
  - `audio`
- `role`
  - `source_image`
  - `start_frame`
  - `end_frame`
  - `driving_video`
  - `reference`
- `label`
- `required`
- `visible`
- `filled`
- `accept`
- `slotIndex`
- `supportsGalleryDrop`

The resolver returns:

- `slots`
- `summaryLabel`
- `usesExplicitSlots`

## Layout Rules

### Prompt-only

- returns no slots
- Studio hides source-media inputs

### Single-image / image-edit

- returns one required image slot
- label:
  - `Source image`

### First-and-last-frame

- returns two visible image slots
- labels:
  - `Start frame`
  - `End frame optional`
- only `Start frame` is required
- `End frame` is always rendered when the model supports it

### Motion-control

- returns two visible slots
- labels:
  - `Source image`
  - `Driving video`
- both are required

## Rendering Path

The standard slot renderer lives in:

- `apps/web/components/media-studio.tsx`
  - `renderStandardComposerSlot(...)`

Desktop and mobile both render from the same slot contract:

- desktop test ids:
  - `studio-standard-slot-*`
- mobile test ids:
  - `studio-mobile-standard-slot-*`

This is intentional. The slot contract is the source of truth. The desktop/mobile difference is presentation only.

## Source Of Truth

The system has three layers:

1. model capability
- from model input patterns and max input counts

2. slot contract
- `resolveStandardComposerSlots(...)`

3. renderer and staging behavior
- `media-studio.tsx`
- `use-studio-composer.ts`

That means:

- layout is decided in one place
- staging/replacement is decided in one place
- backend validation remains unchanged

## Drag And Drop Rules

Standard explicit slots support:

- gallery asset drag/drop
- local file drop
- file picker replacement
- reference-library replacement

Replacement semantics are slot-aware:

- replacing a filled image slot should keep the slot filled
- replacing one slot must not disturb neighboring slots
- wrong media kinds are rejected per slot

Examples:

- dropping an image onto `Driving video` is rejected
- replacing a `Source image` through the reference library preserves `Driving video`
- `Kling 3.0 i2v` keeps both frame slots visible even before either is filled

## Hook Responsibilities

The helper hook keeps the public composer API mostly stable:

- `apps/web/hooks/studio/use-studio-composer.ts`

It now exposes the derived standard layout instead of forcing the component to infer slot structure from scattered booleans.

Important behavior:

- image-slot replacement is capacity-aware
- replacement removes the old plain image attachment in the same update that inserts the new one
- source-asset backed slot `0` is handled explicitly so replacing `Source image` does not create duplicates

## What Still Uses Custom UI

The following remain intentionally custom:

- Seedance top reference groups
- Seedance start/end frame strip
- Nano preset composer
- Nano dedicated image-reference rail

Those flows have model-specific interaction patterns that are not yet migrated onto the shared contract.

## Verification

Helper tests:

- `apps/web/lib/media-studio-helpers.test.ts`

Local developer smoke should stay untracked. When validating this contract manually, cover:

- desktop `Kling 3.0 i2v`
  - both frame slots visible before either is filled
  - gallery image drag into start frame
  - gallery image drag into end frame
- desktop `Kling 3.0 Motion Control`
  - source-image slot visible
  - driving-video slot visible
  - wrong-type image drop rejected for driving video
  - gallery video drag accepted for driving video
- mobile
  - `Kling 3.0 i2v` slot visibility
  - `Kling 3.0 Motion Control` slot visibility

## Safe Extension Path

When onboarding another standard model:

1. add or confirm its input patterns
2. update `resolveStandardComposerSlots(...)` if the model contract is new
3. avoid adding another component-level render branch unless the model genuinely needs a custom surface

The intended direction is:

- one standard slot-contract renderer for normal models
- custom top sections only where the model really has a different workflow
