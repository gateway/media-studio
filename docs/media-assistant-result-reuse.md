# Media Assistant runs and completed-result reuse

The Graph Media Assistant can read completed text and media outputs, select exact results, and prepare an independent next stage. This uses ordinary graph workflows and the existing artifact store; it does not introduce a second execution engine.

## Workflow

1. Ask the assistant to prepare a graph. Apply the reviewed proposal.
2. Ask to review the run. Expand the run card to inspect models, input identifiers, relevant settings and which nodes execute or reuse outputs. Choosing **Review and run** submits the graph; merely choosing a model does not.
3. When the run finishes, result cards appear in the conversation without another assistant reasoning turn. Text can be expanded; images have previews; audio/video have playback controls. Failed or missing outputs cannot be selected.
4. Choose **Use this result**, or ask the assistant to select an unambiguous result from the displayed set. Selection is bound to the session, run, node, output index and exact artifact version. Up to eight results can be selected.
5. Describe the next stage or revision. A reviewed independent-stage proposal opens a new Graph tab with ordinary media loaders or exact text nodes. Previous generators, workflow and history remain intact. The new stage has fresh node IDs and no executable ancestors from the previous graph.
6. Review the new graph before running. Completed media or text is loaded, not regenerated. The stage's new generators still require the normal run approval.

**Remove** and **Clear selected results** recover from stale or unavailable selections. Nothing silently regenerates. Freezing a downstream node does not freeze its ancestors; the run review lists the entire workflow's execution modes.

Result numbering follows the displayed output records, including outputs forwarded by preview nodes. Selection is exact, never an implicit “latest asset” lookup. Video previews expose playback/metadata, not automatic content analysis.

## Persistence and compatibility

Selections and run associations use optional fields in existing assistant session summaries. Selection updates serialize through the existing SQLite transaction owner. No database migration or new table is required.

Materialized nodes carry optional `metadata.source_result` with `schema_version: 1`, originating run/artifact IDs and version. Canvas hydration and serialization preserve it. Existing graphs without the metadata remain readable and keep their prior approval fingerprint. Unknown binding versions fail validation and require explicit reselection.

Graph validation resolves the canonical artifact, verifies its completed state, source fields and media file version, and rejects missing/changed inputs. The binding participates in run approval fingerprints. New-stage application rechecks workspace identity and source content after asynchronous definition refresh, then uses the established tab, canvas and history owners.

Run confirmation is a typed, token-bound action. Malformed actions and unavailable estimates/callbacks display blockers. Cancellation differs from submission failure. Duplicate clicks and consumed-token replays cannot launch a second run. An uncertain submission outcome is surfaced without a blind retry.

## Verification and limits

Focused web tests cover result selection/recovery, workspace isolation, save/reload provenance, assistant confirmation and launch handling. Direct Python unittest files cover public assistant result/proposal/application and confirmation boundaries with database and network access forbidden:

- `apps/api/tests/test_assistant_results_unit.py`
- `apps/api/tests/test_assistant_run_handoff_unit.py`

The repository's pytest fixtures create databases even during collection; they are separate from those direct no-database checks. Browser acceptance uses the existing populated installation and the Media Assistant's normal controls. Non-generative acceptance does not establish paid provider output quality.

Rollback reverts the assistant presentation/tools, binding validation and serialization together, leaving saved media, sessions, workflows and history in place. Do not delete data as part of rollback. Gallery chat, unattended generation, provider retries and video editing are outside this change.
