# Knip adoption review — ticket 27, 2026-10-19

This change adds reporting infrastructure, not a clean-code certification or
automatic deletion policy. Knip findings are informational; execution/format
failures block. Existing lint regression gates remain blocking. No Knip finding
baseline is created. Production mode is excluded from the integration.

## Dependency and entry review

Knip is pinned to 6.42.0; Node 22.22.0 reproduces the trial and dedicated CI.
Installation used npm with lifecycle scripts disabled. The npm-generated lock
adds 57 package entries with no removals. Existing resolutions change only for
`jiti` 2.6.1 → 2.7.0 and `tinyglobby` 0.2.15 → 0.2.17, satisfying Knip's minimum
ranges and deduplicating existing consumers. No application dependency declaration
or analyzer version changes. `npm ls knip jiti tinyglobby --all` verifies the tree.
New transitive/optional packages include OXC parser/resolver platform bindings;
their lockfile platform variants are retained. Linux, macOS and Windows CI run the
real Knip fixtures/reporting command after `npm ci --ignore-scripts` to check
native loading without provider calls, application services or databases.

The seven explicit config/operator entry points, Node test glob and automatic
Next/Vitest coverage are explained in [the analysis README](README.md#knip-unused-code-reporting).
Real-tool source fixtures verify routes/config helpers and test/operator-only
consumers remain reachable, while an orphan file is still reported. Config
entries are not blanket source exclusions. The only ignored dependencies are
the two analyzers invoked through literal binary paths and the web-only Next
`server-only` marker. Platform commands are listed separately as ignored binaries.
No file/export finding is hidden. Next's installed `create-compiler-aliases.js`
maps the marker to `next/dist/compiled/server-only/{empty,index}`; official
[Next documentation](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning)
also identifies installing the marker package as optional.

## Existing contract reconciliation

The lockfile intentionally participates in the existing analyzer contracts.
Measured scans were compared with base `d35169c`; the committed baseline diffs
change **only contract hashes, the lockfile hash and review reasons**. Finding
records are byte-for-byte equivalent after JSON parsing:

| Gate | Measured findings | Existing records retained | Added findings |
| --- | ---: | ---: | ---: |
| ESLint/TypeScript | 723 | 723 | 0 |
| CSS | 1,121 | 1,127 | 0 |
| Production clone pairs | 283 | 283 | 0 |

CSS's six stale exemptions and location drift already existed; this adoption
preserves those records rather than doing unrelated baseline cleanup. Python's
contract does not hash the Node lockfile and is unchanged. No rule/threshold,
scope, severity or analyzer implementation is relaxed. Initial duplication review
caught a 51-token import-header match in the new runner; sorting its imports
removed that incidental match. No new clone exemption was accepted.

## Standalone evidence and integration limits

Default scan on this branch: **6 files, 134 exports, 83 exported types, 1 unused
dependency, 2 unlisted references, 1 duplicate-export group, 0 unresolved imports**.
All other reported categories are zero. Compared with the trial, only the four
reviewed Next marker warnings are suppressed. The remaining categories are
candidates, not confirmed defects. Intentional admin class aliases remain visible.
The reporting fixture suite covers informational findings, real config failures,
missing Knip and malformed output; raw execution and JSON evidence use fresh
directories and CI uploads them even on failure.

Ticket 28 owns the six file candidates; ticket 29 owns the control-api export
slice. Ticket 30 owns the two Playwright imports and direct native runtime
declaration. Their changes are not copied into this branch. The orchestrator must
combine reviewed branches, regenerate the lockfile and re-run full lint/Knip;
reconcile analyzer hashes against exact measured findings. Do not copy one
branch's baselines wholesale or turn a production-mode report into deletion
approval. This branch's counts do not represent the combined source result.

Raw local evidence is external to tracked source in the ticket 27 session evidence
directory. CI artifacts retain per-run execution, metadata, JSON and summaries.
No app instance, data root, database, provider call or settings change is needed.
