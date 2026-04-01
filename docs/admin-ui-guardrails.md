# Admin UI Guardrails

This document defines the locked admin theming system for:

- `Settings`
- `Models`
- `Jobs`
- preset create/edit pages

The goal is to stop style drift and reuse the same admin primitives everywhere.

## Core Rules

1. Use shared admin primitives before adding custom UI.
2. Do not use raw browser-styled controls in admin pages.
3. Keep surfaces to no more than two layers:
   - outer `Panel`
   - optional inner `CollapsibleSubsection` or muted content surface
4. Do not wrap a card inside another card unless the inner surface adds real hierarchy.
5. Use one button system across admin pages.
6. Prefer plain language over engineering/internal wording.
7. Remove duplicated labels or repeated explanations.

## Shared Building Blocks

Use these first:

- `Panel`
- `PanelHeader`
- `CollapsibleSubsection`
- `AdminButton`
- `AdminField`
- `AdminInput`
- `AdminTextarea`
- `AdminToggle`
- `AdminPillSelect`
- `AdminActionNotice`
- `adminInsetCardClassName`
- `adminInsetPanelClassName`
- `adminDashedCardClassName`

Files:

- `apps/web/components/panel.tsx`
- `apps/web/components/collapsible-sections.tsx`
- `apps/web/components/admin-controls.tsx`
- `apps/web/components/admin-action-notice.tsx`

## Buttons

Admin pages should use `AdminButton`.

- Primary: save/create/edit/confirm actions
- Subtle: add/remove/back/helper actions
- Danger: archive/delete/cancel destructive actions

Do not style `Link` to look like a button in admin pages. If navigation should look like a button, use `AdminButton` with router navigation.

## Form Controls

Use:

- `AdminInput` for single-line values
- `AdminTextarea` for larger instructions/templates
- `AdminToggle` for on/off states
- `AdminPillSelect` for custom dropdowns

Do not use:

- raw `<select>` with browser styling
- raw light-theme checkboxes
- white field backgrounds

## Panels

Preferred admin structure:

1. `Panel`
2. optional intro copy
3. `CollapsibleSubsection` for complex form groups
4. direct fields inside the subsection body

Avoid:

- panel inside panel inside panel
- repeated headers inside the same concept block
- status pills when plain text or a toggle communicates the same thing

## Surface Tokens

Use the shared admin surface language instead of hand-copying white-border card styles.

- outer shell: `Panel`
- collapsible groups: `CollapsibleSubsection`
- inset card: `adminInsetCardClassName`
- inset panel: `adminInsetPanelClassName`
- empty state: `adminDashedCardClassName`

Do not introduce harsher `border-white/*` card treatments on admin pages unless there is a deliberate new pattern being locked for reuse.

## Tables

Use compact parameter tables when showing model capabilities.

- show only available or required parameters
- columns:
  - `Parameter`
  - `Required`
  - `Description`
- keep descriptions human-readable
- avoid internal terms like `choice`, `choices`, or raw schema noise unless essential

## Copy

Write for operators, not engineers.

- say what the section does
- say why it matters
- avoid duplicated text
- avoid internal terms like "helper profile" when "system prompt" or "provider" is clearer

## Current Locked Patterns

These areas are the current baseline:

- `Settings > Prompt Enhancement Provider`
- `Settings > Queue Settings`
- `Models > Model Setup`
- `Models > System Prompt`
- `Models > Structured Presets`
- `Models > Preset create/edit`
- `Jobs > Media Studio Runner`
- `Jobs > Recent Jobs`
- `Setup > Current Readiness`

New admin work should match those patterns rather than inventing new ones.

## Runner And Studio Reliability

The admin system also depends on predictable job-state feedback.

- runner failures should be logged, not swallowed silently
- `/health` should expose runner issues when queue processing is enabled
- Studio should distinguish:
  - validation
  - submit
  - provider processing
  - final asset publishing
- terminal job failures should surface the stored job error, not only a generic failure message
- completed media should publish derivatives:
  - images: original, web, thumb
  - videos: original, web mp4, poster

If a provider returns a valid output but local artifact publish fails, the UI should communicate that publish is the blocked phase.
