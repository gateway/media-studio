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
