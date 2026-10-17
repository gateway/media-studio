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

## Main integration, 2026-10-17

Main commit `d143441` added the admin-theme checker before this static-analysis
branch landed. Its two existing ESLint complexity findings are explicitly recorded:
`scripts/check_admin_theme.mjs` `inspectSource.visit` (line 59), CC17, and
`inspectRepo.collect` (line 172), CC19, against the threshold 15. The redundant
regex escape reported by ESLint was corrected and its existing guard tests pass.
The original 889 finding objects are unchanged; the reviewed total is 891. No
focused-harness findings were added and no rules or thresholds were relaxed.
The custom-lint contract changed because it now invokes the admin guard too;
its integration fixture executes the real guard and verifies violation failure.

## Ticket 07: Studio unused imports and local destructuring, 2026-10-17

This first slice starts at `148c828` and changes only `components/media-studio.tsx`
and `hooks/studio/use-studio-composer-core.ts`. The compiler's unused diagnostics
fall from 128 to 48: 72 removed in the shell and eight in composer core. ESLint
unused findings fall by 81 (the all-unused pricing import contains two bindings),
from 763 total ESLint findings to 682. Combined web findings: 891 to 730.

The removed compiler diagnostics are 76 TS6133, three TS6196 and one TS6192.
All remaining diagnostics are existing unused debt; there are zero type errors.
No rules, analyzer contracts, thresholds or unrelated findings change. All 306
ESLint complexity findings keep both their identities and exact measured values,
including the two admin-theme guard CC17/CC19 findings.

Three findings need context-identity refresh, with identical rule, message, owner
and severity. These are existing debt, not new exemptions:

| Finding | Previous ID | Refreshed ID | Why context changed |
| --- | --- | --- | --- |
| TS6133 `initialAssetOffset` | `ff858d05d78a6e496290b430d744a15dcd4f2a3088100c575843f1efd8a4f1e0` | `26e59961595403cf43e6092661c49ae28dca009bb0216ac10661dac37bc68e78` | Parameter fingerprint includes the edited function body |
| TS6133 `closeHref` | `68732c862787b1dbfcac4b5773b53f8fec61fc653ff68ec344ca397b79abd200` | `eae7df3128eb290690c06b15878713693d8c4ce66d8fb9594edc7991bcf5768c` | Parameter fingerprint includes the edited function body |
| exhaustive-deps `setSelectedReferencePreview` | `86f36407e2c226fcd26cdda319b679e3239f663972a1f40c4330b7c678eb50f7` | `31d3a00bbae890a1f076e4a9c063ab734e651af5175cc0ee41276eeb68d06f46` | Adjacent inspector destructuring lost unused bindings; effect unchanged |

The retained public props are `initialAssetOffset` and `closeHref`. The evaluated
`motionControlVideoPreview` and `currentPresetSelectionKey` declarations are also
retained. Every call and argument remains unchanged (561 shell call sites, 225
composer call sites); all declared function parameters remain unchanged. The
TypeScript-emitted runtime import module/binding sequences are identical before
and after (43 shell imports, 16 composer imports), so imports evaluated by the
compiler retain their evaluation order. No explicit side-effect import is removed.
The destructured owners return plain data objects without property getters. The
`useTransition()` call and second tuple element remain intact.

Characterization uses the inspected composer-core, composer-draft, studio-gallery
and studio-gallery-feed tests: four files, 32 tests pass before and after. The
focused harness mocks fetch in hook tests and uses jsdom storage; no app services,
application databases, provider homes or paid requests are used. Local pytest is
not run. Raw analyzer reports, diagnostic enumeration and exact identity/metric
comparisons are retained outside source in the Ticket 07 evidence directory.

The full clone gate requires four context-identity replacements because its
identity includes the entire nonblank file prefix/suffix. All 286 production
pairs retain identical normalized fragments, endpoint files, token counts and
line counts; 282 identities remain exact. Both source slices at each replaced
endpoint are unchanged. Test pairs remain 555. Python's 543 and CSS's 1,127
findings are byte-for-byte equal as parsed finding objects. The dependency graph
loses two unused import edges and retains zero violations.

Here `shell` is `apps/web/components/media-studio.tsx`, `composer` is
`apps/web/hooks/studio/use-studio-composer-core.ts`; other endpoints use their
existing owners. Counts in the last column are unchanged before and after.

| Pair | Endpoints before → after | Previous ID → refreshed ID | Tokens / lines |
| --- | --- | --- | --- |
| Shell / StudioComposer | shell 2069–2074 → 1993–1998; `components/studio/studio-composer.tsx` 137–141 unchanged | `7f0c616aeae8739018c3a498255a6454dcb2ec99d5f9659eb09b0b234338bfbe` → `2b75334ff1408913fe85b50a49d3c001083d6b46c4b8f80c5c6dab5937c0c086` | 54 / 6 |
| Composer / guard effects | composer 532–558 → 524–550; `hooks/studio/use-studio-composer-guard-effects.ts` 63–89 unchanged | `029267464370aacb7058ac86f052798700b8645362c3df4e44cb3ae0825ef232` → `74a1c684149a9cd86353700bd23484110938a2fa8ba92190c98de67985158489` | 52 / 27 |
| Shell / shell | 1318–1325 → 1242–1249; 1381–1388 → 1305–1312 | `cc25e743bb7d7f36db6ed579a76245146ce205e5296ce91c45c524499adfaa96` → `9c05975cfa6eefd2f512b64f57406c2c0cfec979c664d7a5b0cbfb451b97e1ce` | 65 / 8 |
| Shell / shell | 1711–1722 → 1635–1646; 1782–1793 → 1706–1717 | `3b712a9cece3eb03ec0323e94f5332c2bf2f890e65f432ddee88594ed99323aa` → `ce8b9d58b9e92b1e2b51092421d2d7feb67fb828467c2969c40e129b206b918b` | 52 / 12 |
