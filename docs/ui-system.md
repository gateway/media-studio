# UI System

Use the shared UI primitives under `apps/web/components/ui/` for all new Studio and admin work.

## Canonical Controls

- `Button`
  - variants: `primary`, `subtle`, `danger`, `ghost`
  - appearances: `studio`, `admin`
  - use for labeled actions, submit/save flows, retry/delete, and secondary commands
- `IconButton`
  - appearances: `studio`, `admin`
  - tones: `primary`, `subtle`, `danger`, `favorite`
  - use for icon-only actions in headers, inspectors, overlays, and tile chrome
- `PillSelect`
  - shared picker/select surface for both Studio and admin contexts
  - do not define page-local pill dropdowns for the same role
- `ToastBanner`
  - intents: `healthy`, `warning`, `danger`, `working`
  - use for temporary notices, save feedback, import/export results, and floating composer/admin status

## Feedback Rules

- Navigation/config save/import/export/delete actions:
  - show a temporary `ToastBanner`
- Button-scoped async actions:
  - keep inline busy state on the button
  - optionally also show a `ToastBanner` if the action changes global app state
- Batch/job/gallery processing:
  - keep feedback on the card or tile, not as a page-level banner

## Surface Helpers

Use `apps/web/components/ui/surfaces.ts` for common shells:

- `overlayBackdropClassName`
- `overlayPanelClassName`
- `softPanelClassName`
- `floatingChipClassName`

Do not restate the same overlay/panel border, blur, and shadow bundles inline unless a surface is genuinely new.

## Token Rules

- Use semantic theme tokens from `apps/web/app/globals.css`
- Prefer variables like `--ms-action-*`, `--ui-action-*`, `--ms-feedback-*`, `--ui-feedback-*`
- Avoid hardcoding new color/border/shadow values inside feature components unless the value is truly unique

## Usage Rules

- Use `Button` for labeled actions
- Use `IconButton` for icon-only actions
- Use `PillSelect` for Studio/admin selector pills
- Use `ToastBanner` for notices instead of one-off success/error banners
- Avoid raw duplicated action-button class strings in feature components when an existing primitive already fits
