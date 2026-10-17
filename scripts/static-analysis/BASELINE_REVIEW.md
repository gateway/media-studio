# Baseline review, 2026-10-17

Baseline adoption records existing debt and specific known tool limitations. It does
not assert that every finding is a confirmed bug. Application fixes are separate work.

## Additional React and typed rules

Candidate scan: 195 no-floating-promises, 28 no-misused-promises, 59 exhaustive-deps,
9 rules-of-hooks and 1 switch-exhaustiveness-check finding. array-callback-return
found none. Existing 469 ESLint findings and 128 compiler unused diagnostics remain.

- The nine rules-of-hooks reports refer to ordinary callbacks named useAssetAsSource
  in components/media-studio.tsx and useOrderedGenericImageInsert in
  components/studio/studio-composer-restore.ts. The first stages assets/updates state;
  the second is a boolean predicate. These names trigger the hook convention, but
  their definitions do not call React hooks. Preserve the exact baseline findings;
  do not disable the rule by file or globally. Naming cleanup is follow-up work.
- The switch report in hooks/use-graph-run-lifecycle.ts is for optional error.code
  (undefined). Its default returns the label. Existing behavior is handled, while
  the selected rule still requires explicit union cases for future code.
- Async reports include intentionally discarded promises and async UI handlers.
  Neither void nor an async event callback guarantees rejection handling. Existing
  sites remain visible debt; new sites must return, await or handle the promise.
  ignoreVoid is false, and JSX attribute checks stay enabled.
- Effect dependency reports require individual behavior review. Do not bulk-add
  dependencies or suppress them to pass: that can change polling/synchronization.

Identity matching includes enclosing if/case context and adjacent statement tokens
to distinguish repeated calls in one declaration. Line/comment movement remains
stable; edits to surrounding statements may require explicit review. Truly identical
ambiguous contexts still fail closed instead of receiving ordinal exemptions.

## Python dispositions

- FastAPI File(...) in apps/api/app/main.py declares an upload parameter. Ruff's
  B008 setting recognizes the qualified fastapi.File factory only; arbitrary call
  defaults and other factories remain checked.
- B023 reports on synchronous re.sub lambdas in
  apps/api/app/graph/executors/prompt_ops.py, function
  _storyboard_apply_user_owned_panel_notes, do not establish delayed capture: sub
  invokes each callback during the loop iteration. Retain those specific baseline
  identities, with no global B023 suppression.
- Existing F401 facade exports remain visible baseline findings pending export
  contract review. No blanket __init__.py or facade-file ignore is introduced.

All remaining existing Python findings are recorded debt, not inferred waivers.
Ruff C901 and Radon CC are distinct metrics with independent limits of 15. Radon MI
is informational. Baseline refresh is explicit and requires review of added/removed
identities and metric deltas; ordinary lint never modifies either baseline.
