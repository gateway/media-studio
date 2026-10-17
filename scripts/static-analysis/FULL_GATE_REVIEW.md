# Dependency and duplication adoption

Dependency Cruiser 17.4.3 scans all JS/TS entry files under apps, scripts, ops,
tests and root configs, including type-only edges. Cycles, unexplained unresolved
imports and runtime production-to-test imports fail with no baseline waiver.
Next's `server-only` and `client-only` markers are recognized only in apps/web;
they are not globally exempt for operational scripts. External package internals
are not followed. Raw graph edges retain preCompilationOnly and dependency types.

jscpd 5.4.1 scans JS/TS, Python and CSS production/test corpora independently at
50 tokens, 5 lines, mild mode. The initial production baseline contains 286 pairs,
the same pairs measured by the earlier audit: both endpoint locations, matched
content and token/line metrics compare exactly equal. Test clones are informational
(555 pairs in the adoption scan).
Neither corpus's percentage is a pass/fail threshold. Corpus enumeration includes
new/untracked source files; dependencies, build output, declarations and runtime
data are excluded. Shell, PowerShell, templates and semantic duplication are not
measured. No embedding model or remote analysis is used.

Raw jscpd reports omit files below its token threshold from source totals. The
gate therefore runs each enumerated file individually with the same tool/options
and reconciles the aggregate source count with those results. These raw per-file
reports and excluded-file reasons are retained. This adds execution time but
prevents unexplained partial coverage from being accepted. The explicit 50 MB
file-size limit is also recorded in the command; larger source files require
review rather than silently becoming part of a verified corpus.

Clone identities canonicalize both file endpoints, the matched fragment and
normalized source context before/after each endpoint. Blank lines and CRLF line
endings do not affect identity. Full surrounding context is conservative: editing
a flagged file can require review of unchanged clones elsewhere in that file.
Renames, new files, replacement pairs, changed fragments and token growth cannot
inherit an exemption. Ambiguous identical identities fail closed. Ordinary lint
never rewrites a baseline. Refresh uses an explicit reason and is reviewed against
the raw pair endpoints, not aggregate totals.

The existing 286 pairs include repeated API handlers, graph executors, UI state
handling and styles already identified by the audit. Adoption retains their
behavior; this is debt acceptance, not a claim that every pair deserves an
abstraction. No application implementation is changed here. Refactoring remains
in the separately scoped tickets.

Guardian's cached checks allowed jscpd and flagged only Dependency Cruiser's
registry prepare script. Installation disabled lifecycle scripts. npm reports the
same 14 affected packages as ticket 03; this is not a security clearance.
The resolver dependency update changes enhanced-resolve 5.20.1 to 5.22.1 and
tapable 2.3.2 to 2.3.3; other pre-existing package versions remain unchanged.

## Ticket 09 process identification (2026-10-17)

The pure command matcher, Windows query text and JSON result parser now live in
`scripts/studio_process_identification.mjs`. Both executable scripts keep their
query execution, platform guards and process actions; the launcher's default root
stays local. The remaining shared execution scaffolding is intentional within
this ticket's boundary.

The explicit clone refresh preserves all 286 pairs: 281 fingerprints are identical,
four change only because launcher context changes, and the targeted pair shrinks.
The four context-only pairs retain byte-identical raw fragments, tokens and lines:

| Pair endpoints before → after | Tokens | Lines |
| --- | ---: | ---: |
| run_studio 57–71 → 64–78; web_app 52–66 unchanged | 91 | 15 |
| run_studio 292–304 → 253–265; web_app 105–117 unchanged | 69 | 13 |
| run_studio 488–497 / 500–509 → 449–458 / 461–470 | 75 | 10 |
| run_studio 630–649 / 671–690 → 591–610 / 632–651 | 195 | 20 |

The targeted run_studio 138–190 / stop_studio 95–147 pair becomes run_studio
141–159 / stop_studio 94–112: **236 → 95 tokens; 53 → 19 lines**. No additional
production pair or metric increase is accepted. Analyzer configuration, contract,
versions, exclusions and all other baselines remain unchanged.

Characterization used pure slices of each original script before rewiring (six
checks per script), then the same six checks against the shared helper:
`node --test scripts/studio_process_identification.test.mjs`. It covers root hints,
unrelated commands, Windows paths, exact query text, existing loose port parsing,
and malformed/valid JSON result behavior. Static-analysis CI runs this pure test.
Executable entrypoints are never imported; no process queries/actions or app data
are needed. Raw before/after analyzer reports and exact pair comparisons are
retained outside source; the final full gate remains authoritative.
