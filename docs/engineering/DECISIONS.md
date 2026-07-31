# Storyboard Multi-Board Continuity Decisions

## Entries

### 2026-07-23 - Keep reference-storyboard chat separate from preset intake and graph approval

- Context: the exact Earth Games request contains `photographic`, an attached image, and the word `prompt`. Raw substring and broad reference-prompt rules misrouted it into graph/preset behavior; the live model could then auto-apply before the user approved. Incidental backward `Shot N` references and negated style language also corrupted compiled state.
- Decision: match graph/workflow terms as complete semantic terms; make story intent exclude reference-prompt-only compilation and Media Preset orchestration; default attached/reference-image storyboard intake to exactly eight shots when the user supplies no count; suggest/apply a graph only for explicit graph creation approval; accept only contiguous ordered shot headers; ignore negated fantasy/science-fiction style tags.
- Alternatives considered: special-case only the Earth Games prompt; keep six as a hidden default; auto-apply any story response that can compile; trust every `Shot N` occurrence and style keyword literally.
- Risk: the eight-shot default is intentionally limited to reference-image storyboard intake; other storyboard defaults remain six unless the user specifies a count. Unusual non-contiguous numbering is ignored rather than guessed, and explicit counts still take precedence.
- Follow-up: retain the exact browser/session evidence and synthetic regressions; do not broaden the rule to preset, recipe, paid-run, or unrelated graph behavior without a failing contract.

### 2026-07-18 - Refresh reusable node caches only from matching completed artifacts

- Context: after Board 2 completed in a run that later failed on Board 3, Graph Studio displayed Board 2's new output but retained an older `executionCache`. Freezing Board 2 therefore serialized the older run/artifact IDs.
- Decision: treat a full run node's matching completed artifacts as the only automatic cache-refresh authority. Require a non-empty completed output, exact run identity, exact node identity when available, and an output port present in the snapshot; group artifacts by port in output-index order. Otherwise preserve the prior known-good cache.
- Alternatives considered: derive cache IDs from asset IDs inside the displayed snapshot; overwrite the cache on every terminal status; clear cache on any failed overall run; update only when the operator manually selects Run History.
- Risk: a completed backend node that omits artifact records cannot become automatically pinnable during hydration and will retain its prior cache. This is intentional fail-safe behavior because the UI cannot prove a reusable artifact lineage.
- Follow-up: keep the public hydrate -> freeze -> serialize regression and the failed/empty/mismatched preservation tests as the cache contract.

### 2026-07-10 - Keep replacement single-activation and refresh only clean Graph Studio cache snapshots

- Context: the Character preview's actions overlapped the transparent media-node resize handle at low canvas zoom, while four pointer/click handlers could repeat the same request. Separately, a clean Graph Studio-owned browser tab without a saved signature could retain stale muted execution metadata instead of loading the server's frozen cache.
- Decision: open the shared attach-node picker from one click, make hidden preview actions non-interactive and visible actions win the resize-stack hit test, and refresh only clean Graph Studio-owned signature-less snapshots that carry execution metadata. Preserve dirty tabs and unrelated legacy preset snapshots.
- Alternatives considered: keep multi-event dispatch; add another media picker; disable resizing; overwrite all restored tabs; mutate execution mode from run history.
- Risk: preview actions intentionally sit one stacking level above the media resize handle while visible, and clean modern signature-less tabs prefer the server record.
- Follow-up: retain the pointer-sequence, legacy-tab, frozen round-trip, and in-app Browser 17/30 regression gates.

### 2026-07-10 - Use bounded display derivatives for Prompt Recipe vision only

- Context: three original 2048x1152 assets repeatedly disconnected local Prompt Recipe vision before token usage, while two images and the provider probe succeeded; existing web derivatives are hundreds of KB instead of roughly 4 MB each.
- Decision: add an opt-in `prefer_web_variant` path selection and use it only for Prompt Recipe image context. Keep `graph_ref_path` default/original ordering unchanged for KIE models, saves, transforms, and other media execution.
- Alternatives considered: resize/rewrite assets; remove a typed role; switch to a paid prompt provider; raise provider limits blindly.
- Risk: a web derivative can contain less fine detail than the original, but remains sufficient for prompt-level semantic/layout analysis and preserves full originals downstream.
- Follow-up: final browser run proves three ordered references on Boards 2/3; no asset was rewritten.

### 2026-07-10 - Normalize live SHOT-image output before panel compaction

- Context: the live recipe emitted `SHOT 01 image —` sections and `DIALOG:` rows, while the deterministic compactor only recognized `PANEL 01` and `DIALOGUE:` fixtures.
- Decision: normalize SHOT-image headings into the existing panel parser and recognize both dialogue labels with enough budget to preserve the final line.
- Alternatives considered: rewrite the recipe output template; use a front-truncation fallback; add a second panel parser.
- Risk: other unobserved heading dialects remain possible.
- Follow-up: keep the live-format regression and audit final prompts before any paid run.

### 2026-07-10 - Pin the selected workflow to the verified current local prompt model

- Context: the global Studio enhancement record remains pinned to `gpt-5.5` last tested 2026-07-01, while the current local catalog/default and full image-capable probe confirm `gpt-5.6-sol`.
- Decision: set only the four Prompt Recipe nodes in `graphwf_4fd06f50c493` to explicit `codex_local` / `gpt-5.6-sol`; do not mutate global provider configuration.
- Alternatives considered: update the global setting; keep the stale implicit model; use OpenRouter.
- Risk: this workflow will not automatically follow later Studio-default model changes.
- Follow-up: revisit only when intentionally changing the workflow's prompt provider.

### 2026-07-10 - Refresh data-backed definitions before filtering saved edges

- Context: manual saved-workflow loading filtered edges against the component's current definition map; after recipe metadata changed, this could be stale even though the server and later node render exposed the new typed ports.
- Decision: for workflows containing `prompt.recipe` or `preset.render`, force the existing node-definition reload before hydrating/filtering the saved canvas. Keep current-contract filtering after refresh so genuinely stale edges are still removed.
- Alternatives considered: preserve all unknown dynamic edges; bypass edge filtering for Prompt Recipes; rely on a page reload.
- Risk: manual load now awaits one definition refresh for dynamic workflows.
- Follow-up: browser verification requires the rendered edge count to match the validated saved edge count before Run.

### 2026-07-10 - Classify conditional effects from story-owned text

- Context: compiled recipe templates can describe optional time-freeze handling even when the user's story does not request it.
- Decision: when a rendered prompt contains labeled `USER STORY BRIEF` or `CONTINUATION BRIEF` sections, use only those sections to classify freeze behavior; retain whole-prompt classification for legacy/unlabeled inputs. For a positive classification, emit the exact causal state sequence explicitly.
- Alternatives considered: strip individual template phrases; disable freeze handling during compaction; parse every recipe field in the model executor.
- Risk: a custom labeled brief that intentionally spreads story content across multiple paragraphs will classify only the labeled paragraph blocks recognized by the current template convention.
- Follow-up: browser prompt-only verification checks the real three-board compiled prompts for contamination and progression.

### 2026-07-10 - Repair one persisted graph and mute all media execution surfaces

- Context: the corrected assistant contract does not migrate an already saved workflow, while Phase 4 must exercise recipes without paying for image generation.
- Decision: after a checksummed database backup, update only `graphwf_4fd06f50c493`; preserve every node ID, position, prior output, and media field; add only the six missing dependency/reference edges; and persist all four KIE model plus four save nodes as muted.
- Alternatives considered: broad workflow migration; broad seed refresh; creating a replacement workflow.
- Risk: dynamic typed-port hydration currently marks the browser tab as unsaved and generic help copy can warn about absent `Image References` even when typed references are connected.
- Follow-up: Phase 4 verifies prompt-only execution, carried previews, and unchanged media-job counts; the generic warning remains a separately scoped UI issue.

### 2026-07-10 - Reuse saved Environment output as the dependency anchor

- Context: downstream recipes and models need the same generated environment, and the save node is the normal surfaced/carry-forward output boundary.
- Decision: generated plans connect `Environment Sheet Recipe -> Environment GPT Image 2 -> Save Environment`, then use `Save Environment.image` for every storyboard recipe `environment_ref` and every storyboard model's ordered image reference 2. If a canvas already has a titled saved Environment node, continuation plans reuse it.
- Alternatives considered: connect directly from the Environment model; create a separate environment loader; add imperative execution sequencing.
- Risk: a reused saved node must have a valid current or carried-forward output at run time.
- Follow-up: BUG-202 preserves the existing environment preview/output, and Phase 4 verifies muted/carry-forward behavior in the real canvas.

### 2026-07-10 - Declare recipe roles in metadata and keep dynamic role text authoritative

- Context: Storyboard recipes had typed-role prose but no `image_input.reference_roles`, while Continuation statically assigned the previous board to image 2.
- Decision: Storyboard v2 declares `character` and `environment`; Continuation declares `character`, `environment`, and `additional`. Runtime-generated `reference_role_block` remains authoritative, and the canonical prose documents Character @image1, Environment @image2, previous board @image3.
- Alternatives considered: expose generic `image_refs` alongside typed ports; introduce `storyboard_ref`.
- Risk: saved storyboard recipes wired to generic ports require explicit repair rather than silent compatibility.
- Follow-up: BUG-202 repairs only the authorized workflow after backup; no other workflow is mutated.

### 2026-07-10 - Treat TEST-002 failures as the implementation contract

- Context: the broad dirty worktree already contained partial typed-role and carry-forward work, and the documented baseline exposed deterministic mismatches rather than one clean failing test.
- Decision: record the exact red set before application edits: missing Storyboard typed-role declarations/ports, missing Environment graph construction, conditional time-freeze contamination, and missing exact time-freeze state-order retention. Keep the dependency-order and muted/frozen retention characterizations green.
- Alternatives considered: repair application source while discovering tests; weaken existing assistant assertions to match generic ports.
- Risk: later phases could accidentally turn a red test green for the wrong reason.
- Follow-up: each task runs its narrow selection and inspects the scoped diff before moving to the next task.

### 2026-07-10 - Use both text and image handoffs

- Context: prompt chaining preserved story descriptions but did not preserve board layout or visual ending state.
- Decision: every continuation board receives the previous recipe prompt as private text handoff and the immediate previous board image as visual continuity/layout reference.
- Alternatives considered: text-only handoff; Board 1 image as the only master reference for every board.
- Risk: the prior image can overpower new scene content.
- Follow-up: prompts must say the prior board image locks layout and ending state, not scene content to duplicate.

### 2026-07-10 - Environment is a recipe input and a model input

- Context: the active graph supplied the generated environment to GPT nodes but not to the storyboard recipes that author the final prompts.
- Decision: saved environment feeds each storyboard recipe through `environment_ref` and each GPT node as ordered `@image2`.
- Alternatives considered: model-only environment input.
- Risk: duplicated instructions if recipe and model order disagree.
- Follow-up: assert edge order and role text together.

### 2026-07-10 - Prefer existing typed roles over a new public port

- Context: prompt recipes already support `character_ref`, `environment_ref`, `prop_refs`, `style_ref`, `additional_refs`, and `image_refs`.
- Decision: use `additional_refs` for previous storyboard images initially. Do not introduce `storyboard_ref` without evidence that the existing contract is ambiguous in tests/UI.
- Alternatives considered: immediately add a dedicated public `storyboard_ref` port.
- Risk: `additional_refs` is semantically broad.
- Follow-up: reconsider only after Phase 0 tests and prompt-only browser evidence.

### 2026-07-10 - Immediate previous board is the default visual handoff

- Context: Board 3 needs the most recent character/environment/action state, while Board 1 is the strongest original layout example.
- Decision: Board 2 uses Board 1; Board 3 uses Board 2. An extra Board 1 master-layout input for Board 3 is deferred until a prompt-only comparison proves it helps without confusing roles.
- Alternatives considered: send Board 1 and Board 2 to Board 3 by default.
- Risk: layout drift can accumulate across generations.
- Follow-up: Phase 5 rubric measures layout drift; add master layout only if needed.

### 2026-07-10 - Dependency edges own execution order

- Context: the runtime now prioritizes completed-output surfaces while respecting dependencies.
- Decision: encode Environment -> Boards and Board N -> Board N+1 through graph edges. Do not rely on canvas position, titles, fixed sleeps, or hardcoded sequential loops.
- Alternatives considered: imperative scheduler sequencing by storyboard number.
- Risk: missing edges allow legal but undesired parallel execution.
- Follow-up: exact-edge tests and browser status timing.

### 2026-07-10 - Paid proof is a separate confirmed phase

- Context: image generation costs credits and output is probabilistic.
- Decision: finish tests and a no-paid browser run first; obtain explicit action-time approval for exactly one environment plus three-storyboard run. Seedance remains muted.
- Alternatives considered: paid test during implementation.
- Risk: prompt-only success may not translate to visual success.
- Follow-up: use the Phase 5 review matrix before considering another run.

### 2026-07-10 - Treat the failed paid proof as terminal evidence

- Context: the single approved paid run completed Environment and Board 1, then Board 2 was rejected by provider policy and Board 3 dependency-skipped.
- Decision: do not rerun, delete, or silently rewrite prompts. Preserve the failed run and successful assets, remute all paid branches, and treat the observed `CELL NN` compaction loss as a new BUG-501 contract.
- Alternatives considered: immediate retry; manual prompt shortening; bypassing the prior-board image; enabling Board 3 separately.
- Risk: the exact moderation trigger is not provider-explained. Board 1's more exposed lower-body framing is a plausible visual-handoff contributor, but remains an inference.
- Follow-up: add red no-network fixtures for the exact live `CELL NN` raw outputs, preserve six ordered actions/dialogue/final handoff plus covered non-sexual framing, then complete a no-paid browser proof before seeking separate approval for another paid run.

### 2026-07-10 - Preserve storyboard semantics before generic environment terms

- Context: live storyboard recipes use `CELL NN` action blocks and may also mention environment/location continuity. Generic environment classification and metadata-only compaction removed the story before provider submission.
- Decision: classify recognized storyboard structure before incidental environment wording, normalize `CELL NN` to ordered panel capsules, prioritize explicit action and bounded scene context, parse blank dialogue line-by-line, and add covered neutral non-sexual framing at the final provider-prompt boundary.
- Alternatives considered: raise the prompt limit; modify only recipe prose; manually shorten the campaign prompt; rerun the provider without a deterministic fix.
- Risk: bounded compaction is still lossy for unusually dense panels, and the provider's prior moderation cause remains unknown.
- Follow-up: keep exact live-format fixtures as the contract. Seek new action-time approval before any paid visual proof.

### 2026-07-10 - Model the hangar and cockpit as one connected environment sheet

- Context: Boards 1 and 2 must remain beside the same ship in one hangar, while Board 3 deliberately moves through the ramp into the cockpit and then launches through the same doors.
- Decision: generate one environment continuity sheet containing two physically connected zones—hangar and cockpit—with a visible ramp/corridor transition. Keep that sheet as `@image2` for every board, and use the immediate previous board as `@image3` for continuations.
- Alternatives considered: reuse the hangar-only environment for cockpit shots; add a second paid cockpit environment lane; let Board 3 invent the cockpit from text alone.
- Risk: one sheet must make both zones readable without becoming crowded; the no-paid prompt gate must confirm the recipe assigns environment and layout roles unambiguously.
- Follow-up: score hangar geography, cockpit design, transition path, and ship exit separately in VERIFY-705.

### 2026-07-10 - Normalize bounded live storyboard forms into one capsule contract

- Context: repeated no-paid runs emitted semantically equivalent prompts using split reference-role paragraphs, `titled exactly`, fixed spatial 3x2 headings, neutral-subject title rewrites, and late technical state terms.
- Decision: prefer explicit per-token `Use @imageN` paragraphs, normalize only the observed `TOP/BOTTOM × LEFT/CENTER/RIGHT PANEL IMAGE` headings into panels 01-06, canonicalize neutral subject suffixes to `BOARD N OF M`, and append bounded causal `State:` terms inside the existing ACTION row. Reuse the existing capsule parser and 4,200-character target.
- Alternatives considered: raise the budget; accept fallback truncation; add per-run manual prompt edits; create separate parsers for every heading form.
- Risk: a materially new unlabeled format can still fall outside the parser and must become a new exact fixture rather than an unbounded heuristic.
- Follow-up: keep final no-paid raw/shaped audit mandatory before any later paid proof.

### 2026-07-10 - Treat the PAID-704 Board 1 rejection as terminal reference-risk evidence

- Context: the one approved Phase 7 run generated a strong Environment, then Board 1 failed provider moderation despite a bounded prompt with covered/neutral guards and correct Character/Environment reference order.
- Decision: do not retry. Preserve the run and Environment asset, freeze/mute all paid branches, and propose BUG-712 to find a fully covered, private-text-free identity reference before any later provider proof.
- Evidence: the actual Character `@image1` visibly repeats an exposed midriff/cropped suit and `SADI / AGE 26`, directly conflicting with the provider prompt's covered/private-text contract. The provider does not reveal its exact moderation trigger, so this remains the strongest observed contributor rather than a proven cause.
- Alternatives considered: immediate retry; remove Environment; omit Character; manually weaken safety wording; run Board 1 alone.
- Risk: a replacement reference can drift identity or require additional paid generation. Existing compliant assets must be searched first, and any generation or storyboard retry needs separate approval.
- Follow-up: SPEC-016 and BUG-712; no implementation or paid action is currently authorized.

### 2026-07-10 - Reuse a neutral identity portrait instead of generating another character sheet

- Context: BUG-712 found no existing same-character sheet that was both fully covered and private-text-free. The original imported face/upper-body portrait is neutral, contains no embedded text, and is the identity source from which the prior sheet was derived.
- Decision: use `ref_3c38d161cdc3` for face/hair identity only; move clothing/cyborg continuity into positive workflow text; do not create another paid character asset.
- Alternatives considered: keep the exposed/private-text sheet; use a prior storyboard as identity reference; generate a replacement sheet.
- Risk: a portrait provides less body/outfit guidance than a full sheet. Deterministic prompts must preserve the enclosed cream/red suit and red mechanical limbs.
- Follow-up: if a later Board 1-only proof still fails after BUG-714, request separate approval for a purpose-built neutral sheet.

### 2026-07-10 - Pin Environment carry-forward to its successful node outputs

- Context: the strongest Environment was created inside a graph run that later failed at Board 1, so ordinary muted carry-forward selected an older completed-run asset.
- Decision: freeze Environment GPT and Save with explicit `cached_run_id=grun_6ed69a0a6f86`; keep `asset_123e29b65e70` as every board's environment reference 2.
- Alternatives considered: regenerate Environment; accept the older completed-run sheet; replace the Environment branch with another Load Image node.
- Risk: Graph Studio currently hydrates saved frozen state as Muted.
- Follow-up: BUG-715 fixes hydration; saved-workflow API remains the bounded fallback until then.

### 2026-07-10 - Treat PAID-713 as terminal and harden from its exact raw evidence

- Context: the newly authorized run used the safe portrait and correct Environment but Board 1 was still provider-policy rejected. The provider gave no category, and no credits were charged.
- Decision: do not retry. Preserve `grun_b005f9a1dbf8` / `job_02c012a45027`, remute all board nodes, and use the exact raw/submitted prompt as a no-network regression fixture.
- Evidence: the compactor did not recognize `Top-left panel:` through `Bottom-right panel:`; it dropped the panel plan and retained negative safety vocabulary.
- Alternatives considered: immediate Board 1 retry; omit the character reference; weaken the continuity contract; enable Boards 2/3 independently.
- Risk: moderation remains probabilistic and the precise provider trigger is undisclosed.
- Follow-up: BUG-714 positive-only spatial compaction, BUG-715 browser repair, then fresh approval for at most a Board 1-only proof.

### 2026-07-10 - Express provider-facing safety as positive production direction

- Context: the failed submitted prompt repeatedly named unwanted sexualized/violent concepts even though they were negated.
- Decision: provider-facing compact prompts specify one practical fully enclosed crew-workwear design and neutral task-focused professional framing. They no longer enumerate `pin-up`, `underwear`, `wardrobe removal`, `skin exposure`, `cleavage`, `midriff`, `gore`, or `injury`.
- Alternatives considered: keep stronger negative prohibitions; remove wardrobe guidance entirely; raise the prompt budget.
- Risk: positive-only wording is less explicit about every undesired failure mode.
- Follow-up: exact paid-raw replay must retain the character/workwear contract, all panels, all references, and every story beat before another provider request is considered.

### 2026-07-10 - Keep the browser-attached Character sheet and stop after Board 1 visual review

- Context: after BUG-715, the user explicitly directed that the Character sheet already present in Graph Studio remain in place and authorized Phase 9 completion. The live browser state resolved that sheet as `asset_901adc9b21d1`.
- Decision: do not open Replace or substitute another Character asset. Run only Board 1, review it before any continuation spend, then freeze the successful output and stop when material visual gaps are found.
- Evidence: `grun_6c158a8dd274` / `job_64495d8b780d` succeeded, but the output exposed the midriff, truncated metadata values, and opened the final service panel early.
- Alternatives considered: restore `ref_3c38d161cdc3` before the run; proceed immediately to Boards 2/3; retry Board 1 with new prompt wording.
- Risk: the retained sheet remains a strong wardrobe signal that conflicts with the covered-workwear requirement; prompt-only control may remain probabilistic.
- Follow-up: retain the sheet as requested, keep Boards 2/3 muted, and require a no-paid remediation slice plus fresh action-time approval before any additional provider job.

### 2026-07-11 - Keep the canonical Character asset and separate authority in prompt text

- Context: the user reaffirmed that the existing Character sheet must remain. Phase 9 proved that the full sheet remains a strong wardrobe signal even when the prompt requests enclosed workwear.
- Decision: Phase 10 does not replace, crop, derive, or reorder Character media. It strengthens generic positive provider-boundary language so `@image1` owns recognizable identity and cyborg construction while the prompt owns one continuous high-collar cream/red flight-mechanic coverall.
- Alternatives considered: restore the identity portrait; create an identity crop; generate a covered reference sheet; accept the Phase 9 wardrobe drift.
- Risk: prompt-only authority remains probabilistic against a full visual sheet. Phase 10 can prove deterministic prompt quality, not final visual compliance.
- Follow-up: if a later separately approved Board 1 proof still follows the sheet wardrobe, revisit a non-destructive derived identity reference as a new explicit design decision.

### 2026-07-11 - Spend the Phase 11 budget sequentially, not as blind trilogy retries

- Context: the user authorized up to five paid runs to finish three consistent storyboards and permit fine-tuning.
- Decision: prove one board at a time. Freeze an accepted upstream board before generating its dependent board; use the accepted immediate prior board as reference 3; reserve unused attempts for the earliest visible failure and downstream regeneration.
- Alternatives considered: enable all three boards on every run; spend all five attempts automatically; reuse a downstream board after changing its upstream reference.
- Risk: sequential proof takes longer, but prevents spending on boards whose handoff source is already rejected.
- Follow-up: record every attempt, visual verdict, state transition, and cost under PAID-1102; stop early when the full chain passes.
### 2026-07-12 - Replace near-copy handoffs with user-owned adjacent-state deltas

- Context: Phase 15 proved near-identical handoffs, but the next board's first panel could waste a frame and shared shaping contained campaign nouns and footer chrome.
- Decision: preserve prior visible state while requiring a user-authored action/dialogue/shot-purpose delta; require speaker/voice attribution; remove the page footer; expose dialogue, handoff, wardrobe, and subject-design cues as recipe inputs; keep shared shaping campaign-agnostic.
- Evidence: 179 focused tests pass; no-paid `grun_b0b8fc718710` passes 11/11 deterministic gates; paid `grun_d7da4a50b807` proves layout/footer/dialogue improvements but fails feline Bolts, covered waist, and the second visual handoff.
- Follow-up: retain the terminal proof and use the new structured appearance cues before any separately authorized future run. Do not retry automatically.

### 2026-07-13 - Consolidate storyboard camera and framing at the provider boundary

- Context: prompt/image audit found redundant CAMERA and FRAMING rows competing with exact dialogue and action under the 4,200-character compact target. The displayed old Board 2 has blank CAMERA/MOTION rows, while PAID-1909's newer Board 2 prompt has CAMERA values but never produced an image. The displayed Board 3 robot is an older pre-BUG-1907 cache whose generic slice omitted the panel plan.
- Decision: Phase 20 uses one CAMERA row for camera angle/movement/lens followed by shot size/subject placement. Exact DIALOG remains a separate protected row. The NOTES label is mandatory, its value may be blank, and it cannot receive clipped tails from another row.
- Alternatives considered: retain seven rows and raise per-panel budgets; keep FRAMING but remove MOTION or NOTES; solve the issue only by shortening this campaign's user inputs.
- Risk: this is a visible built-in recipe/layout contract change, so every shared storyboard owner, shaper regression, and saved built-in version must move together. Existing paid images remain historical seven-row evidence.
- Follow-up: PAID-2005 exposed a malformed KIE poll response. Harden the recovery boundary under BUG-2006 without submitting another provider request.

### 2026-07-13 - Recover submitted paid work before resuming dependency-skipped nodes

- Context: Board 2's provider task kept running and completed after Media Studio exhausted three rapid non-JSON status polls. The Graph run had already failed and marked five downstream nodes `upstream_failed`.
- Decision: treat `Poll failed:` Graph failures as recoverable, reconcile the existing submitted job, and rerun only descendants skipped for `upstream_failed`. Preserve completed/cached/bypassed nodes and muted skips. Never resubmit the recovered model job.
- Evidence: `grun_97a000ce7558` reused `job_dd3fbdb6778c`, then submitted only the originally authorized Board 3 job. The final trilogy consumed exactly 30 credits and the focused recovery target passes both interrupted and poll-failed variants.
- Risk: recovery still depends on the Media job reaching an authoritative local terminal state; a permanently malformed provider status endpoint remains an infrastructure failure rather than permission to duplicate a paid task.
- Follow-up: retain the recovered run and manifest as the Phase 20 terminal proof; no additional paid run is needed.
### 2026-07-15 - Move storyboard-sheet chrome out of the generative renderer

- Context: Storyboard v2 and Continuation now share one immutable layout contract, but repeated paid proofs still show board-specific title strips, metadata geometry drift, clipped text, and omitted subject traits. The shared 4,200-character compactor and semantic preflight improve prompt correctness but cannot make a generative raster model produce pixel-identical typography and chrome.
- Decision: keep story creation in Prompt Recipe user fields, normalize both recipe results into one typed `StoryboardSheetSpec`, generate art-only panel imagery, and assemble all sheet chrome/metadata deterministically with a backend-owned Pillow compositor. Support one equal 3x2 art grid to retain current cost and six panel images as an optional higher-fidelity input.
- Alternatives considered: continue adding regex repairs; use the prior board or a blank sheet only as an image reference; tolerate visual layout variance; immediately switch to six paid panel calls per board.
- Risk: extracting art from one generated grid still depends on equal panel boundaries, and migrating the current workflow adds nodes/edges. Keep the legacy direct-sheet path additive, prove the compiler/compositor offline, back up the database before target-workflow migration, and require separate approval for any paid proof.
- Follow-up: BUG-2412 and CONTRACT-2501 through VERIFY-2506 are complete. Unicode punctuation is rendered through a validated cross-platform TrueType candidate chain; the compositor fails explicitly if no suitable font exists. Any new art-only paid trilogy requires separate authorization.

### 2026-07-16 - Generate a 4:3 2x3 source plate and reflow it into the final 3x2 sheet

- Context: the first Phase 27 paid output showed that GPT Image returned six frames as two columns by three rows. Treating that image as a final 3x2 grid forced nearly square source cells into wide windows, cropped action, and made the deterministic sheet look like a new metadata-heavy design.
- Decision: request a 4:3 source plate with a row-major 2-column by 3-row grid. Each source cell is approximately 2:1, closely matching the final wide art window. Media Studio then extracts those six ordered cells and deterministically reflows them into the approved 3-column by 2-row sheet. The final chrome, metadata contract, one-provider-image-per-board cost, and story ownership do not change.
- Alternatives considered: keep requesting a 16:9 3x2 source grid; crop the provider's 2x3 result harder; generate six separately paid panel images; redesign the sheet around tall panels.
- Risk: the image provider remains generative and may still violate the requested grid. The renderer therefore reports `wide_2x3_source_grid`, tests exact source order/geometry, and the paid workflow stops at the first invalid dependency boundary instead of automatically spending on later boards.
- Follow-up: Board 1 is accepted and frozen. A separately authorized Boards 2-3 proof is the remaining visual gate.

### 2026-07-16 - Restore the selected sheet hierarchy and reject mixed cache contracts

- Context: the user preferred the dark/amber visual language in historical `asset_338f93c9c12b`, but the current graph mixed one art-only Board 1 cache with complete-sheet Board 2-3 caches. The compositor then sliced old typography and chrome as if they were panel art, producing nested layouts, weak action framing, and oversized/repeated metadata.
- Decision: retain deterministic sheet rendering but move to layout v3. Render SHOT exactly once as the panel heading, keep CAMERA/ACTION/MOTION/DIALOG/NOTES as five compact rows, and return the removed row height to the cinematic image. Accept a one-image provider cache only when prompt provenance proves the current 4:3/2x3 art-only contract or explicit audited lineage declares both the contract and grid.
- Evidence: original-resolution layout-v3 proof restores the compact title/production band and image-dominant panels. Browser run `grun_be172e6a307c` renders Board 1 and rejects the historical Board 2 cache before slicing, with zero media jobs and no credit spend. Focused tests pass 111/111 and the full backend passes 871/871.
- Alternatives considered: return full sheet typography to GPT Image; accept all historical art-only prompts; inspect images with OCR; hardcode known asset IDs; redesign the storyboard again.
- Risk: Boards 2-3 need newly generated same-contract art before a full live trilogy can be composed. The guard intentionally rejects ambiguous caches instead of guessing their grid.
- Follow-up: PAID-2807 is an optional, separately authorized one-trilogy proof. VERIFY-2808 must inspect raw art and composed sheets together before final visual signoff.

### 2026-07-17 - Make the historical storyboard hierarchy a typed deterministic display contract

- Context: layout v3 removed duplicate SHOT rows but still looked like a compact dashboard rather than the user-selected historical production board. Generated metadata length and serialization varied across local recipe runs, causing tiny type or intermittent false-positive fragment failures.
- Decision: layout v4 owns the historical visual hierarchy deterministically: thin amber frame, one unified inline header, strong condensed board/SHOT headings, image-first 3x2 panels, and only CAMERA/ACTION/MOTION/DIALOG/NOTES below each image. `StoryboardSheetSpec` is the final display boundary and applies generic complete-boundary fitting to generated SHOT/CAMERA/ACTION/MOTION. Structured user panel notes override generated NOTES by panel number; exact DIALOG/NOTES are never silently shortened.
- Alternatives considered: return full sheet rendering to GPT Image; widen metadata until all prose fits; keep adding serialization-specific regex patches; change the user's story fields; hardcode current campaign terms.
- Evidence: `grun_0c441e491fd6` passes all recipes/compilers and Board 1 composition at zero credits, then correctly rejects the incompatible frozen Board 2 complete-sheet cache. Final proof `tmp/phase29-proof/board-1-layout-v4-final.png` matches the intended hierarchy. Focused tests pass 128/128 and the full backend passes 895/895; genericity, compilation, and diff checks pass.
- Risk: frozen historical Board 2-3 complete sheets cannot serve as art-only 2x3 sources. A new full visual trilogy therefore requires separately authorized PAID-2908; deterministic signoff does not claim new provider art.
### 2026-07-17 - Audit typed storyboard sheets instead of text-free provider art as finished sheets

- Context: Phase 30's provider prompts intentionally contain text-free cinematic art only, while the deterministic compositor owns all visible sheet chrome and metadata. The legacy trilogy audit still applied finished-sheet row and layout checks to the provider art prompt, creating false D001/D002/D011 failures after a valid paid run.
- Decision: when all three boards carry a typed `StoryboardSheetSpec`, validate the six typed panel records and shared layout contract, validate the text-free art-source contract separately, and prove adjacent handoffs through the prior-output reference chain plus distinct SHOT/CAMERA/ACTION/MOTION values. Preserve the legacy full-sheet prompt path for historical evidence.
- Evidence: the new red-to-green typed-art regression passes in a 7/7 focused target. Paid run `grun_c14f1f0b747a` now passes every deterministic gate; its visual scorecard separately records the repeated CAMERA phrase and upright Bolts body.
- Follow-up: do not treat deterministic acceptance as visual acceptance. BUG-3011 owns the remaining no-paid generic content/design hardening; any later provider proof requires fresh authorization.

### 2026-07-17 - Enforce affirmative visual context at the art-provider boundary

- Context: Phase 31 Board 3 was policy-rejected at zero cost because an otherwise benign generated prompt repeated negative wardrobe and identity exclusions, including `never expose` and `underwear`.
- Decision: convert recipe-produced visual-context clauses to affirmative provider directions immediately before compiling the art prompt. Retain positive user-owned traits and story beats; discard negative exclusion tails generically. Do not hardcode campaign nouns, character names, assets, or current story actions.
- Alternatives considered: retry the identical prompt; add story-specific replacement phrases; remove wardrobe/subject context entirely; change the retained Character reference.
- Evidence: the red test reproduces negative wardrobe/subject clauses; the green provider prompt retains the sealed garment, quadruped paws, and low horizontal torso while excluding the negative terms. Exact Board 3 browser preflight passes and `job_781f42c08b0d` completes.
- Risk: affirmative shaping cannot guarantee provider acceptance for arbitrary content, but it removes a known avoidable policy-trigger pattern without weakening typed metadata or story ownership.
- Follow-up: keep provider safety shaping generic. BUG-3110 separately addresses newest-completed-output hydration when freezing a node after a later run failure.
