# Storyboard Multi-Board Continuity Verification Log

## Entries

### 2026-07-24 - Media Assistant orchestration and storyboard execution audit

- Runtime: started `npm run dev`; API, Studio, and Graph Studio returned HTTP 200. The development process was intentionally left running for user testing.
- Chrome session: inspected the existing Earth Games assistant/canvas without sending a message, applying a plan, saving, or starting a run. The assistant panel restored one attached reference and the four-message conversation, but no applied-plan card.
- Session evidence: `asst_889e59f57505` contains one eight-shot story segment and an applied 23-operation plan, but is `owner_kind=standalone` with `owner_id=null` and `applied_workflow_id=null`. The same story session also contains an unrelated `reference_style_brief` synthesized from storyboard prose.
- Trace evidence: the initial turn was labeled `graph_workflow_builder` while loading `story_project.md`; the approval turn was labeled `general_helper` while emitting `create_graph_plan`. The built-in transcript-quality result fails the 9,418-character storyboard reply with `assistant_long_unformatted_reply`.
- Persisted run evidence: existing run `grun_233afa2fcd42` on `graphwf_4030e4539bf6` failed at `assistant-storyboard-environment-model` with `Storyboard preflight failed: panel sequence is empty; expected [1, 2, 3, 4, 5, 6, 7, 8].` No run was started during this audit.
- Root cause: the assistant graph builder passes the complete storyboard/panel prompt to the Environment Sheet recipe. Generic GPT Image 2 execution then infers storyboard semantics from prompt text and applies metadata-row preflight to the environment model.
- Automated checks: focused web assistant tests pass 83/83 and `npm run typecheck:web` passes. The backend assistant/preflight selection completed with 429 passing and 10 temporary-database write failures caused by the initial read-only sandbox; the exact 10 affected tests passed 10/10 when rerun with test-database write access. No application assertion failed. These green existing checks do not cover the assistant-plan-to-environment-runtime seam.
- Planning artifacts: [Media Assistant Orchestration and Storyboard Execution Spec](MEDIA_ASSISTANT_ORCHESTRATION_SPEC.md) and [task list](MEDIA_ASSISTANT_ORCHESTRATION_TASKS.md). Recommended first task: test-only `MAO-001`.

### 2026-07-23 - Media Assistant reference-storyboard Phase 5

- Browser red/green loop: the first disposable proof reproduced preset-prompt substitution and premature six-panel application; the next exposed five-shot default/premature apply; later proofs exposed backward `Shot N` references inflating state to ten and negated `fantasy` becoming a positive style term. Each failed disposable graph was immediately undone before a focused regression and scoped fix.
- Final browser proof: session `asst_889e59f57505` attached `138c374c-d8be-49bf-aa28-c2d1bf06e21c.png`. The original Earth Games prompt produced visible Shots 1–8 with no graph mutation. The exact approval command then applied 23 local operations / 11 nodes. Stored and compiled counts/numbers are exactly 8 / `[1,2,3,4,5,6,7,8]`, latest plan status is `applied`, `run_requested=false`, undo was enabled, and reload restored the graph plus assistant-applied state.
- No-paid accounting: credits 517.62 -> 517.62; latest media job stayed `job_ab6c459f93e2`; latest graph run stayed `grun_44a5864f47ba`. Run and workflow Save were not used.
- Automated gates: exact MAS-001/002/003 17/17; full `test_media_assistant.py` 375/375; prompt assets 3/3; focused web intent/panel/history 86/86; web typecheck; 494-file lint; theme drift; `git diff --check`. The file-size gate and `release:verify:full` stop only because unrelated `apps/api/tests/test_graph_studio.py` has 7,001 lines against 7,000. This accepted deviation remains outside the fix scope.

### 2026-07-19 - Phase 33 revised two-capacitor/Bolts paid trilogy

- Prompt gate: the first zero-credit attempt `grun_067e9b4d1c8e` correctly stopped on the Board 2 compiler limit and exposed contraction rewriting; it created no media job. Tightened dialogue and story fields removed the contractions and reduced redundancy. Second zero-credit run `grun_02e170898650` completed all three recipes and six-panel compilers at 3,945 / 3,829 / 3,913 characters with exact titles/dialogue and media jobs unchanged at 720.
- Reference proof: persisted edge order and actual normalized requests agree. Board 1 used Character then Environment. Board 2 used Character, Environment, then this run's Board 1 raw image. Board 3 used Character, Environment, then this run's Board 2 raw image. Recipe outputs explicitly assign those sources to `@image1`, `@image2`, and `@image3` respectively.
- Paid result: the single Run click created `grun_95ca568765eb`. Board 1 `job_825880176d32` / `asset_22f4fbaad9bf`, Board 2 `job_68733fa6c331` / `asset_b67cf3c0c12f`, and Board 3 `job_bbd359f4ebc0` / `asset_cfe6dfc13a98` completed once each. No retry, duplicate, Environment generation, Seedance action, topology change, or provider/model/pricing change occurred.
- Save result: all three enabled Save nodes completed in Sadi (`project_ab78ce28660d`) as `asset_graph_8160a296ed46fdf43f38aa9a`, `asset_graph_3bf3103063e8610509a599f0`, and `asset_graph_b3b1198cc4b373d8dd9c283f`; every finished sheet is 2048x1152 layout v4.
- Original-resolution visual verdict: PASS. Board 1 shows pilot and feline cyborg Bolts walking together to the closed amber panel and contains both assigned lines. Board 2 explicitly depicts two failed installed capacitors, two clean replacements on one tray, both failures removed with two empty sockets, two clean units installed under green confirmation, and both assigned lines. Board 3 shows both walking and ascending together, Bolts climbing into and sitting in the adjacent chair, three assigned lines including Bolts' diagnostic line, one current ship lifting with a visible air gap, and that same single ship exiting the north doors.
- Accounting/closure: balance 189.62 -> 159.62, exactly 30 credits / $0.15. Media jobs 720 -> 723, graph runs 789 -> 792 including both zero-credit preflights, and media assets 679 -> 685 account for three raw plus three saved images. The revised Board 2-3 source remains in active `continuation_brief` fields with additional source locks; all three recipes and all nine art/compositor/Save nodes are Frozen, estimate is approximately 0 credits / $0, API/runner are healthy, queue is 0/0, and database integrity is `ok`.

### 2026-07-19 - PAID-3203 Board 3-only continuation and terminal visual review

- Authorization/preflight: the user freshly authorized PAID-3203. Pricing refreshed successfully to `2026-07-19-site-pricing-page`; API/embedded runner were healthy, queue was 0/0, database integrity was `ok`, baseline media jobs/runs/assets were 719/788/677, and browser balance was 199.6. Only Board 3 GPT/compositor/Save were enabled; Boards 1-2 and every unrelated provider branch remained Frozen. The fresh browser estimate was exactly 10 credits / $0.05 with Save targeting Sadi.
- Reference proof: persisted exact-port edges order Board 3 inputs as Character, Environment, then Board 2. The submitted normalized request contains exactly those three local images in that order; the third is PAID-3201 Board 2 `job_a86146618b44` / `asset_cc82aca40ca8`. Run metrics prove Boards 1-2 reused Frozen caches from `grun_e2afaa39b574` and were not regenerated.
- Paid result: the single Run click created `grun_3e468f355396`. Board 3 `job_978911d388e6` completed once as raw 2048x1536 art `asset_06af0960023d`; the deterministic compositor produced 2048x1152 `ref_a101ca1c93b1`; Save created `asset_graph_cc5b59dd67dc246f10a1fa64` in Sadi (`project_ab78ce28660d`). No retry, duplicate submission, Character/Environment replacement, recipe/layout/schema/topology/provider/model/pricing change, or Seedance action occurred.
- Visual pass: the accepted Boards 1-2 and new Board 3 share identical layout v4 frame, title/production chrome, font hierarchy, panel/image/row geometry, and readable footer-free CAMERA/ACTION/MOTION/DIALOG/NOTES rows. Character, covered workwear, ship/hangar Environment, cinematic treatment, repair-to-ramp progression, Board 2 Panel 6 -> Board 3 Panel 1 adjacent-but-advanced handoff, ramp boarding, compact feline Bolts with mechanical forelegs, separate secured occupants, and final north-door departure pass.
- Visual reject: Board 3 Panel 5 depicts the occupied cockpit looking through its canopy at a second matching ship hovering ahead. That contradicts the single-ship continuity lock and does not unambiguously prove vertical lift of the current occupied ship. VERIFY-3204 therefore completes with strict full-trilogy signoff withheld. The successful assets remain evidence and no retry is authorized or implied.
- Accounting/closure: browser balance 199.6 -> 189.6, exactly 10 credits / $0.05. Media jobs 719 -> 720, graph runs 788 -> 789, and media assets 677 -> 679 reflect one provider output plus one saved composed asset. All nine storyboard art/compositor/Save nodes are Frozen, estimate is approximately 0 credits / $0, API/runner remain healthy, queue is empty, and database integrity is `ok`.

### 2026-07-18 - Phase 32 post-BUG-3110 terminal partial paid proof

- Preflight: backup `data/backups/media-studio-backup-20260718T094841Z.db` passed integrity with SHA-256 `ecb53fa055ef99e9b0d63b7c1577009caa2ba386ec4b02ffc67c1eaaeabec448`. API/runner were healthy, queue was 0/0, baseline media jobs were 716, browser balance was 219.6, and the enabled Boards 1-3 art/compositor/Save branches estimated exactly 30 credits / $0.15.
- Prompt/spec proof: zero-credit recipe/compiler replay completed all three typed compilers. A historical Board 2 complete-sheet cache was correctly rejected by the current art-only compositor and was not reused. Provider-bound prompts contain six cinematic action cells; the role clauses assign character identity to `@image1`, ship/hangar geography to `@image2`, and the immediate previous board to `@image3` on continuations.
- Actual reference proof: normalized requests record Board 1 = Character + Environment; Board 2 = Character + Environment + this run's Board 1 raw art; Board 3 = Character + Environment + this run's Board 2 raw art. This matches both browser edge badges and persisted exact-port workflow edges.
- Paid result: the single authorized click created `grun_e2afaa39b574`. Board 1 `job_e795f18b3f4f` / `asset_677de9a66248` and Board 2 `job_a86146618b44` / `asset_cc82aca40ca8` completed. Board 3 `job_9641977d3661` failed with `Internal Error, Please try again later.` Its compositor and Save descendants skipped. No retry occurred.
- Saved outputs: Board 1 `asset_graph_1e903703e74422d26657f56d` and Board 2 `asset_graph_e9e02eb7d91cf74f0f31ea3d` are 2048x1152 assets in Sadi (`project_ab78ce28660d`).
- Original-resolution review: Boards 1-2 pass identical deterministic layout, font hierarchy, amber/black chrome, panel/image/row geometry, footer-free five-row metadata, complete readable values, cinematic action framing, selected character identity with covered workwear, and the saved red-and-cream ship/hangar Environment. Story progression passes approach/loading -> exterior inspection -> closed amber panel -> latch release -> diagnosis/replacement/green closure. Board 1 Panel 6 -> Board 2 Panel 1 is adjacent but visibly advanced.
- Strict disposition: full trilogy signoff is withheld because no new Board 3 asset exists, so Bolts, boarding/launch, and Board 2 Panel 6 -> Board 3 Panel 1 cannot be evaluated for this run. This is a transient provider failure, not a deterministic contract failure.
- Accounting/closure: balance 219.6 -> 199.6, exactly 20 credits / $0.10. Media jobs 716 -> 719 includes the retained failed Board 3 request. All nine storyboard art/compositor/Save nodes are Frozen; browser estimate is approximately 0 credits / $0; API/runner are healthy; queue is empty; database integrity is `ok`.
- Automated checks: 110/110 focused storyboard metadata/spec/compositor/trilogy tests pass, the recipe/compiler genericity guard passes, and `git diff --check` passes. Optional PAID-3203 requires fresh authorization for Board 3 only; Boards 1-2 must remain frozen.

### 2026-07-18 - BUG-3110 newest-completed frozen-cache hydration

- Reproduction: a saved enabled provider node carried `run-old` / `artifact-old`; the newest overall run failed only after that node completed as `run-new` / `artifact-new`. Hydrating the run, switching the completed node to Frozen, and serializing reproduced the defect by retaining the old cache IDs.
- Root cause: Graph Studio applied the completed node's newest `output_snapshot_json` to the canvas but never refreshed `executionCache`. The execution-mode switch correctly preserved that cache, which made it preserve stale IDs.
- Repair: completed full-run hydration derives a cache only when the output snapshot is non-empty and artifacts match the exact run, node, and output port. Artifact order follows `output_index` and duplicates are removed. Failed, queued, skipped, cancelled, empty, artifact-free, wrong-run, and wrong-node states cannot replace a known-good cache.
- Focused verification: 32/32 tests pass across node runtime, workflow hydration, terminal run lifecycle, and the public hydrate -> freeze -> serialize seam. The regression now emits `cached_run_id=run-new` with `cached_artifact_ids.image=[artifact-new]`.
- Full verification: 900/900 backend tests and 762/762 web tests pass, along with repository hygiene, storyboard recipe/compiler genericity, file-size/style guardrails, web lint, web typecheck, production build, Studio browser smoke, and `git diff --check`.
- Browser closure: the in-app Graph Studio tab reloads successfully with no console errors, a visible approximately-zero-cost estimate marked stale after reload, and the existing Frozen/Cached nodes present. No Run click, workflow save, provider submission, media job, asset mutation, or credit spend occurred. The signed-off Phase 31 trilogy remains unchanged.

### 2026-07-17 - Phase 31 antialiased metadata and final saved trilogy

- Root cause: Phase 30 measured only fully opaque text pixels. Actual antialiased glyph edges in wrapped metadata reached one pixel above the row rule. The renderer now requires 3px glyph-to-rule clearance and uses the existing 14px floor only where a 15px wrapped value cannot fit.
- Typed hardening: equivalent repeated CAMERA-contract tails are removed without dropping subject framing. Provider-bound visual context is converted to affirmative directions; the exact Board 3 art prompt is 3,982 characters and contains none of `never`, `underwear`, `expose`, `humanoid`, `bipedal`, or `midriff`.
- Automated gates: 139 affected storyboard tests pass after the final provider-boundary change. The earlier Phase 31 focused gate passed 102 tests and the final complete backend passes 900/900 in 264.06s. Compilation, genericity, database integrity, diff, backup, runtime, and queue checks pass.
- Paid accounting: Board 1 `job_03628ebae938` / `asset_54d60149cdc0`, Board 2 `job_a8240e7aa90c` / `asset_5920b3b27555`, and Board 3 `job_781f42c08b0d` / `asset_d8c710d43e26` completed. One Board 3 policy rejection consumed 0 credits. Total balance moved 249.6 -> 219.6, exactly 30 credits / $0.15, with no successful board regenerated.
- Saved sheets: Board 1 `asset_graph_110ad4f2d56a07cebafd72ea`, Board 2 `asset_graph_ed294a0aa592ffc959edb495`, and Board 3 `asset_graph_329d7b42dcf91a78638ac792`. All three raw grids and all three sheets are assigned to Sadi (`project_ab78ce28660d`).
- Pixel proof: all sheets are 2048x1152. Across 15 wrapped rows the minimum antialiased glyph-to-rule clearance is 3px and the failure list is empty. Original-resolution review finds no clipped second-line wording.
- Visual verdict: PASS. The three sheets have identical deterministic chrome, font hierarchy, image geometry, labels, colors, and metadata order. Character and weathered hangar/ship continuity hold; Board 1 approaches/inspects, Board 2 opens/repairs/closes, and Board 3 advances from the repaired panel through ramp/cockpit/lift/departure. Bolts is a compact feline cyborg cat with feline head/body, paws, harness, and mechanical forelegs.
- Closure: all paid nodes are Frozen, browser balance is 219.6, graph estimate is approximately 0 credits / $0, API/runner are healthy, and the queue is empty. BUG-3110 separately owns the non-blocking stale frozen-cache hydration observed during recovery.

### 2026-07-14 - Phase 22 paid acceptance proof and metadata-budget repair

- Paid execution: `grun_83c378c36f03` produced Board 1 `job_89bb63c6bbc7` / `asset_49f3103fd168`, then failed closed before Board 2 submission on `Panel 04 NOTES is empty`; 10 credits / $0.05 were consumed and Boards 2-3 cost $0 in that run.
- Reproduced cause: exact Board 2 replay showed that dialogue-aware panel fitting reserved the exact spoken line plus ACTION/MOTION preferred budgets before NOTES, allowing a supplied row-local note to receive zero characters.
- Repair: the compact fitter now reserves a readable 24-character floor for each required ACTION/MOTION/NOTES row before preferred expansion. It reuses only the recipe/user-owned value already in that row and adds no campaign content. Exact failed-prompt replay now produces non-empty Panel 04 NOTES and passes metadata preflight with exact dialogue intact.
- Continuation proof: `grun_cdaa9401bbbe` completed all 17 nodes with Board 1 cached, Board 2 `job_225ce43e1dff` / `asset_d82c55094f72`, and Board 3 `job_fc801cfa9df1` / `asset_139ca5940aa0`. Both new outputs are 2048x1152. The continuation consumed 20 credits / $0.10, making the Phase 22 three-board total exactly 30 credits / $0.15; balance 459.6 -> 429.6.
- Visual pass: same upper-left board-title/top production-strip/3x2/six-row footer-free system; differentiated 1/3-3/3 metadata; photoreal feature-film stills; fixed ship/hangar and recurring pilot; causal repair-to-ramp-to-cockpit-to-launch flow; Board 1->2 and Board 2->3 handoffs remain adjacent but visibly advanced; Bolts is a small feline cyborg cat rather than a humanoid.
- Visual reject: metadata still contains complete-word but incomplete-clause fragments (`Panel opening is.`, `Only the clean.`, `The pilot begins.`, `Final payoff —.`), and the newly paid Board 1 exposes a service compartment in Panel 04 before Board 2's opening beat. The system is not visually signed off; BUG-2205 owns the no-paid remediation.
- Automated closure: focused metadata/preflight target 18/18; exact failed-prompt replay passes; full backend 780/780; storyboard genericity and `git diff --check` pass. API/runner are healthy with queue 0/0. In-app Browser shows 429.6 credits, eight Frozen paid model/save nodes, approximately 0 credits / $0, Run available, and no active run.

### 2026-07-12 - Phase 17 Uber review remediation and runtime sign-off

- Review: `docs/reviews/20260712-042852-media-studio-uber-review.md`; initial focused result 354 passed / 10 failed reproduced CR-001/002/003 and the missing recipe-deployment migration.
- Repairs: typed Prompt Recipe intent arbitration; explicit/ambiguous multi-recipe targeting; declared-role-only image port selection; migration 43; one Python Prompt Recipe contract owner; consolidated storyboard user cue fields; unreachable prompt-shaping helper removed; stale environment-sensitive assertions made deterministic.
- Focused closure: 367 passed in 103.87 seconds.
- Full release closure: `npm run release:verify:full` passes; API 750/750; complete web suite 132/132 files; repo hygiene, file-size/style guardrails, lint, typecheck, production build, Studio smoke, clean schema version 43, and `git diff --check` pass.
- Browser finding/fix: reload initially logged repeated React maximum-update-depth errors from repeated `userSizedHeight` writes. The updater is now idempotent; the next reload rendered the full 17-node canvas with no new error timestamps. Post-fix typecheck, 494-file lint, 45-route production build, HTTP health, and diff formatting pass.
- Runtime: live database schema/latest version 43 with no pending migrations; API and embedded runner healthy; queue 0/0; Graph Studio HTTP 200; no new paid run, provider job, asset, or credit spend occurred in Phase 17.
- Legacy decision: active helper facade, legacy skill-id translation, and pre-hash session compatibility were retained because current call sites/persisted readers prove reachability. CLEANUP-1706 tracks safe structural extraction; no unproven legacy deletion was performed.

### 2026-07-11 - Phase 12 six-run closure and best-trilogy signoff

- Paid accounting: six complete Board 1-3 runs, 18 generated boards, 180 credits / $0.90; balance 899.6 -> 719.6. The pre-provider Codex timeout `grun_aa382ee15e5b` and reload interruption `grun_cc64b46ca4b7` submitted no media job and cost $0.
- Attempt runs: `grun_bab3560be616`, `grun_8a5027818dd7`, `grun_538158c313b9`, `grun_94f5771700c6`, `grun_e39207d96114`, and `grun_1f520678365b`.
- Selected best: attempt 5 / `grun_e39207d96114`; jobs `job_d442eb7ba298`, `job_854352f25f0b`, `job_beb8d161b9ab`; assets `asset_362ab770ad2b`, `asset_e2f7c447794f`, `asset_cf80b084f4ff`; reference counts 2/3/3.
- Best visual pass: identical gold/black complete sheets and PAGE 1/3-3/3 footers; photoreal cinematic cells; visible fixed hangar/ship Environment; distant Board 1 pilot with droid supply chain; fully covered mechanic workwear; causal inspection and capacitor repair; physical ramp/corridor boarding; Bolts first visible in Board 3 Panel 3 with mechanical forelegs and harness; complete exact dialogue; clear airborne departure.
- Best residual: Board 3 Panel 5 shows an exterior ship through the cockpit canopy, weakening the lift proof before Panel 6 resolves the ship airborne. Attempt 6 corrected that one composition but regressed the essential Board 1 pilot, footer numbering, and wardrobe, so it was rejected without mixing boards across runs.
- Deterministic hardening: compact prompts now prefer closed-panel state, exclude departing droids from ramp-entry state, assign the retained Character reference identity/cyborg authority only, add a concrete opaque mechanic waist guard, remove negated pre-reveal cat mentions, lock the first cat appearance to Panel 3, and prevent a second exterior ship in the cockpit lift shot.
- Automated closure: full `apps/api/tests/test_graph_studio.py` passes `172 passed in 88.28s`; focused remediations pass; `py_compile` and `git diff --check` pass.
- Frozen closure: all six storyboard GPT/Save nodes are frozen to attempt 5 artifacts; Environment GPT/Save remain frozen; saved workflow validates `valid=true` with zero errors/warnings; in-app Browser reload from the saved workflow shows all board pairs Frozen and graph estimate approximately 0 credits / $0; API/runner healthy; queue 0/0; no Seedance.

### 2026-07-11 - Phase 12 deterministic and zero-cost preflight

- Contract: SPEC-024 locks identical complete sheet chrome, photoreal live-action movie-still cells, dominant Environment authority, distant Board 1 walk-up with droids entering the ramp, causal capacitor repair, mechanical secured Bolts, visible floor-drop lift, and same-door departure.
- Live-format repair: exact GPT-5.6 headings `PANEL NN image and metadata:` now normalize into six bounded panel capsules; full-panel state extraction retains environmental approach, mechanical forelegs, lift, and airborne evidence in compact NOTES.
- Automated gate: full `apps/api/tests/test_graph_studio.py` passes `169 passed in 82.79s`; Python compilation and `git diff --check` pass.
- Backup: `data/backups/media-studio-before-phase12-20260711.db`, SHA-256 `a8ba1e6f8d6160bc000e6b981544cb2dd916a9a11292ce158fecdfe072c59f77`, `quick_check=ok`.
- Browser no-paid run: `grun_f775621a7ce3` completed with all three board GPT/Save pairs muted, Environment frozen, and media jobs unchanged at 645.
- Exact replay: Board 1 4,115 chars, Board 2 4,191, Board 3 4,193; each retains six SHOT/CAMERA/FRAMING/ACTION/MOTION/DIALOG/NOTES sets, exact complete-sheet/cinematic/Environment locks, ordered refs, and required story terms.
- Paid preflight: API/runner healthy; queue 0/0; 17 nodes/30 edges; zero validation errors/warnings; all three board GPT/Save pairs enabled; Environment frozen; browser shows 899.6 credits and exactly 30 credits / $0.15; no Seedance.

### 2026-07-11 - Phase 12 full attempt 1 and remediation

- Run: `grun_bab3560be616` completed `job_5271cfd2821f`, `job_7a277fc54ad6`, and `job_62a21d5de6c5` in dependency order. Outputs: `asset_6bf3ce7c653b`, `asset_615d3ef45710`, `asset_eb6638a1d7df`, all 2048x1152. Reference counts 2/3/3; Board 2 reference 3 is attempt-1 Board 1 and Board 3 reference 3 is attempt-1 Board 2.
- Accounting: 30 credits / $0.15; balance 899.6 -> 869.6; no Environment or Seedance job.
- Visual pass: all three use the same upper-left title, PROJECT/SEQUENCE/LOCATION/DATE/ARTIST strip, 3x2 grid, seven-row metadata, and bordered footer; imagery is markedly more photoreal/cinematic; Board 1 opens wide with the pilot distant and droids loading; repair, boarding, cat reveal, harness, and departure progress clearly.
- Visual reject: exposed waist/lower-back styling persists; Board 3 visibly shortens the exact dialogue to `“Bolts.”`; lift frame lacks an unmistakable ground gap; Board 3 Panel 1 NOTES combines closed/open service panel state.
- Root cause: the submitted continuation prompt included six outline-only `PANEL NN` headings before the six real metadata panels. Those empty capsules consumed the bounded prompt and truncated the final dialogue. Reference-lock text also reintroduced wardrobe authority from @image1.
- Remediation: outline-only panels are ignored unless at least four director fields exist; @image1 authority is normalized without consuming @image2/@image3; continuous garment, exact DIALOG, floor-drop/airborne, and tighter service-panel state locks are retained. Full Graph Studio target: `170 passed in 80.04s`.
- Zero-cost reproof: `grun_018dfed216a9` completed with media jobs unchanged at 648. New exact raws compact to Board 1 3,542, Board 2 4,084, Board 3 4,117 characters; each has exactly six complete metadata sets and passes every attempt-2 contract.
- Pre-provider abort: `grun_aa382ee15e5b` failed before any media submission because `prompt.recipe-58cc3b4c` (Environment Sheet Recipe) timed out after 360.92 seconds. Actual cost $0; credits remained 869.6; all three board models skipped. Because the Environment image is already frozen, its Recipe and Preview are now muted; Environment GPT/Save stay frozen to the proven asset. API/runner and Codex Local readiness are healthy, queue 0/0, validation clean.

### 2026-07-11 - Phase 11 five-run trilogy closure

- Budget/result: all five authorized paid runs were used; 50 credits / $0.25 total; browser balance 949.6 -> 899.6. Attempts 1-2 were rejected Board 1 refinements; attempts 3-5 produced the accepted Board 1/2/3 chain.
- Deterministic remediation: compact metadata now recognizes bare `PANEL NN` headings, never cuts inside a word, removes dangling connector tails, retains long hand-near-latch state, normalizes doubled neutral articles, and positively seals opaque workwear at the jawline/upper chest. Full `apps/api/tests/test_graph_studio.py`: `167 passed in 81.22s`; `py_compile` and `git diff --check` pass.
- Live no-paid audit: `grun_8d85b7379854` created no media job; exact replay retained six complete metadata sets, `@image1/@image2`, the closed amber hand-latch handoff, jawline coverage, and no internal state markers or dangling fragments.
- Accepted Board 1: `grun_e1370bed4813` / `job_3982415e2b19` / `asset_60c6f076511e`, 2048x1152. Exact Character plus frozen Environment references submitted. Passes enclosed suit, causal loading/inspection, complete metadata, and closed-panel handoff.
- Accepted Board 2: `grun_e8206374dbeb` / `job_5d304cc4b9b7` / `asset_a50774289804`, 2048x1152. Three ordered references include accepted Board 1 as reference 3. Passes same hangar/ship/character, capacitor repair progression, funny dialogue, green/closed-panel ending, and matching per-frame layout.
- Accepted Board 3: `grun_62ae7afc8796` / `job_be63042ba8b6` / `asset_ca6180f66b9a`, 2048x1152. Three ordered references include accepted Board 2 as reference 3. Passes ramp/corridor/cockpit continuity, one secured cyborg cat, harness/preflight before lift, exact dialogue once, and same-ship hangar exit.
- Closure: Character `asset_901adc9b21d1` unchanged; Environment `asset_123e29b65e70` reused without regeneration; all three accepted GPT/Save pairs and Environment frozen; 17/30 valid with zero warnings; queue 0/0; API/runner healthy; browser estimate approximately 0 credits/$0; no Seedance.
- Residual visual note: Boards 2-3 add the same compact top production strip and bordered footer area absent from Board 1. All three retain the required 3x2 panel geometry and identical seven-row metadata system beneath every frame.

### 2026-07-11 - Phase 11 paid attempt 1 rejected with bounded remediation

- Preflight: backup `data/backups/media-studio-before-phase11-20260711.db`, SHA-256 `deaecb03e07b0bb1e69e932875939166982e3c25145c61d9bdd493a55c76d632`, `quick_check=ok`; API/runner healthy; queue empty; valid 17/30 graph; Character unchanged; Environment frozen; only Board 1 GPT/Save enabled; estimate 10 credits/$0.05.
- Run: `grun_3abd7136960e` completed in 371.17 seconds. The only provider job, `job_f748088fbb66`, submitted 3,443 characters and received exactly Character `asset_901adc9b21d1` as reference 1 plus frozen Environment `asset_123e29b65e70` as reference 2. It created 2048x1152 `asset_cf512c0663cc`.
- Accounting: credits 949.6 -> 939.62; media jobs 640 -> 641; graph runs 694 -> 695; queue returned to 0/0.
- Visual pass: exact 16:9 six-panel 3x2 layout; stable dark/yellow metadata design; all ordered labels; values end at complete words; strong retained red/cream ship, hangar, ramp, gantries, loading lane, robots, materials, lighting, and Panels 1-5 inspection progression.
- Visual reject: waist/back followed the retained Character sheet rather than a fully enclosed underlayer; Panel 6 showed the ramp/diagnostic direction rather than the closed amber service panel with hand near latch; `State:` continuity phrases rendered inside ACTION.
- Remediation: state terms move to NOTES, compact wardrobe authority adds an opaque one-piece textile base layer visible beneath every armor seam, and the selected workflow Board 1 brief explicitly locks the closed amber panel/hand-latch/ramp-background ending. Board 1 was remuted; Environment stayed frozen; Boards 2/3 stayed muted; no Seedance.

### 2026-07-11 - Phase 10 BUG-1004 and VERIFY-1005 closure

- BUG-1004: compact storyboard prompts that actually reference `@image1` now assign that reference identity/cyborg-construction authority only and assign wardrobe authority to a high-collar, long-sleeve, full-torso cream/red flight-mechanic coverall from shoulders through waist to boots. Text-only prompts do not gain an invalid image token.
- Focused Phase 10 gate: seven prompt-shaping cases pass `7 passed, 159 deselected`; the final latch-synonym check passes with the adjacent late-state regression.
- Exact Phase 9 replay: 10,102 -> 3,626 characters against a 4,200 target; six copies each of SHOT/CAMERA/FRAMING/ACTION/MOTION/DIALOG/NOTES; no known mid-word fragments; closed service panel, amber indicator, and hand near latch retained; capacitor/internal components excluded; identity and wardrobe authority retained.
- Automated gates: full `apps/api/tests/test_graph_studio.py` passes `166 passed in 82.64s`; `py_compile`, duplication/reference search, `git diff --check`, and saved workflow validation (`valid=true`, zero errors/warnings) pass.
- File-size gate: known red remains at `graph-studio.tsx` 2324/2300 and `test_graph_studio.py` 6598/4900. Phase 10 did not touch the web coordinator; three scoped regression cases were added to the existing Graph Studio integration-test owner.
- Runtime/browser: API and embedded runner healthy; queue 0/0; in-app Browser shows `Sadis Adventures`, 17 nodes/30 edges, current Character preview, Environment and Board 1 frozen, Boards 2/3 muted, no Seedance, 949.6 credits, ≈0 credits/$0, and no console warnings/errors.
- Side effects: Run was not clicked; media jobs stayed 640 and graph runs stayed 694. No asset, workflow, reference, provider job, credit balance, or non-target workflow changed.

### 2026-07-11 - Phase 10 TEST-1001 and BUG-1002

- TEST-1001: three new public-seam cases failed independently for mid-word metadata, negated/future Board 1 state plus missing closed-panel handoff, and missing prompt-owned wardrobe authority.
- BUG-1002: the existing `_sentence_limit` now prefers late punctuation, then late whitespace, then earlier punctuation. It does not introduce another compaction path.
- Focused red -> green: `test_gpt_image_2_graph_prompt_shaper_shortens_metadata_at_whole_word_boundaries` changed from failure to `1 passed, 165 deselected`; all six panels/seven labels and the <=4,200-character target remain asserted.
- Paid side effects: none; no browser or workflow mutation in this slice.

### 2026-07-11 - Phase 10 BUG-1003 state-boundary isolation

- Implementation: generic negative-direction clauses are removed before state-term matching; specific open/closed service-panel, amber-indicator, and hand-near-latch terms supersede their generic duplicates.
- Focused result: Board 1 handoff plus late-state and both spatial-heading regressions pass `4 passed, 162 deselected`.
- Behavior: Board 1 no longer promotes a negated capacitor/internal-components sentence into positive state; Board 2/3 positive capacitor, replacement, steady-green, cat, and launch terms remain covered by the adjacent tests.
- Paid side effects: none.

### 2026-07-10 - PAID-716 Board 1 proof and VERIFY-717 terminal Phase 9 review

- Authorization/scope: fresh user approval for Phase 9 completion; keep the Character sheet already attached in the browser; one Board 1-only paid run; no automatic retry; Boards 2/3 and Seedance remain off.
- Preflight: backup `data/backups/media-studio-before-phase9-board1-20260710T154521Z.db`, SHA-256 `f22e54c3042f06bce79633a1dbdf85eabda323df8f7931e007c4f08c3181ba32`, 560,570,368 bytes, `quick_check=ok`; API/runner healthy; queue empty; Graph Studio HTTP 200; 17 nodes / 30 edges; 959.6 credits; live estimate 10 credits / $0.05.
- Focused deterministic gate: `3 passed, 160 deselected` for fixed-grid spatial headings, live spatial headings, and positive-only coverage framing; `git diff --check` passed. The first two attempted Python executables lacked pytest; the shared KIE runtime completed the actual test run.
- Browser execution: exactly one Run click. `grun_6c158a8dd274` completed in 349.7543 seconds with 12 completed, 1 cached, 4 skipped, and 0 failed nodes. Environment reused `asset_123e29b65e70`; Boards 2/3 GPT/save nodes stayed muted.
- Provider result: the only new job, `job_64495d8b780d`, completed from the retained Character sheet `asset_901adc9b21d1` first and frozen Environment second. Submitted prompt length 3,398; output `asset_d9d0ccdff7fd`, 2048x1152. Credits 959.6 -> 949.6; media jobs 639 -> 640; media assets 585 -> 586; graph runs 693 -> 694.
- Visual PASS: one 16:9 six-panel 3x2 sheet; stable dark board, yellow accents, panel numbering, and metadata-strip geometry; all seven ordered metadata labels; blank DIALOG rows; consistent red/cream ship and ruined-hangar geography; robots/loading plus manifest, landing gear, hull seams, connections, and amber-alert story progression.
- Visual FAIL: CAMERA/FRAMING/MOTION values visibly truncate mid-word; pilot wardrobe exposes the midriff despite the covered-workwear prompt; Panel 06 shows an open service bay instead of ending at a closed alert-lit panel. No Board 2/3 proof was justified.
- Safe closure: Board 1 GPT/Save frozen to `grun_6c158a8dd274`; Environment GPT/Save frozen; Boards 2/3 GPT/Save muted; graph estimate approximately 0 credits / $0; queue empty; no Seedance; saved validation `valid=true`, zero errors/warnings.
- Isolation: all 266 non-target workflows match the pre-run SHA-256 `7cca868ae7e30838f25235d5fec7ab2eb7ab78985bea6226888baa0a4d864bed`. Target-only changes intentionally retain the browser-attached Character asset and pin the successful Environment/Board 1 outputs. Final `git diff --check` passed.
- Output: `data/outputs/2026-07-10/20260710_155227_gpt_image_2_image_to_image_job_64495d8b780d_output_1/original/output_01.png`.

### 2026-07-10 - BUG-715 selected replacement and frozen-cache browser signoff

- Red tests: one complete pointer sequence called Character replacement three times; a clean Graph Studio-owned signature-less tab did not refresh the authoritative saved workflow. Frozen mode/cache already round-tripped correctly once the saved record was hydrated.
- Implementation: replacement now opens from one click; the compatibility callback/event each emit once; hidden preview actions do not intercept resize input and visible actions sit above the transparent resize handle; clean Graph Studio-owned execution snapshots refresh from the server while dirty/unrelated legacy snapshots remain protected.
- Browser: the in-app picker opened in attach-node mode, selected existing `sadi-face_chest.jpg` / `ref_3c38d161cdc3`, and stayed 17 nodes / 30 edges. Environment GPT/Save rendered Frozen before the run and Frozen/Cached after it.
- Run `grun_5c92ebb07834`: completed in 221.84 seconds with 9 completed, 2 cached, 6 muted skips, and `actual_cost_usd=0.0`; media jobs stayed 639 with zero queued/running.
- Persistence: Character remained `ref_3c38d161cdc3`; both Environment nodes retained `mode=frozen` and `cached_run_id=grun_6ed69a0a6f86`; target workflow SHA-256 stayed `03709b73a640086035b69b65653226393fa4f36903af078323cdd5c50ff2d7ac`; all 266 non-target workflows stayed `7cca868ae7e30838f25235d5fec7ab2eb7ab78985bea6226888baa0a4d864bed`.
- Automated gates: Graph Studio web tests `310 passed`; TypeScript typecheck; web lint `494 files`; theme-drift guardrail; and `git diff --check` pass.
- Broader gate: `quality:file-size` remains red on pre-existing out-of-scope `graph-studio.tsx` (2324/2300) and `test_graph_studio.py` (6476/4900); BUG-715 added no lines to either file.
- Review: all ten required deliverables created under `docs/reviews/20260710_223334/`; `CR-715-01` and `CR-715-02` are resolved with zero open blockers. API generation succeeded for evidence and its out-of-scope generated diff was not retained; the repository has no `audit:api-security` script.
- Backup: `data/backups/media-studio-backup-20260710T151421Z.db`.

### 2026-07-10 - BUG-709 live-format hardening and final VERIFY-703 pass

- Browser runs `grun_d3fd9f4eb696`, `grun_895928c0cbaf`, and `grun_4474801695d8` completed without media jobs and exposed bounded live-output variants: split reference-role paragraphs, `titled exactly`, late causal state terms, and fixed-grid `TOP-LEFT` through `BOTTOM-RIGHT PANEL IMAGE` headings.
- Red/green behavior: each observed form now reuses the same ordered capsule parser; neutral subject title suffixes normalize to `— BOARD N OF 3`; state capsules retain fuel/coolant/status/green and other story-critical nouns without raising the 4,200-character target.
- Final browser proof `grun_4dab614d88dd`: 9 local/preview nodes completed, 8 paid/save nodes skipped, media jobs remained 636, and dependency order was Environment -> Board 1 -> Board 2 -> Board 3.
- Current-code final replay: Environment 6,085 -> 4,176; Board 1 10,788 -> 3,711; Board 2 12,662 -> 3,851; Board 3 14,842 -> 3,886. Storyboards retain ordered refs, exact titles, six panels, six copies of all seven row labels, required beats/dialogue/final handoff, safety guards, and no non-freeze/private/provider contamination.
- Gates: 14 focused prompt-shaper/title cases; full `apps/api/tests/test_graph_studio.py` `158 passed in 76.16s`; `py_compile` and `git diff --check` pass.

### 2026-07-10 - PAID-704 terminal Board 1 moderation failure and VERIFY-705 closure

- Action-time scope: exactly one paid Graph Studio Run click; no retry, Seedance, or video.
- Preflight: backup `data/backups/media-studio-before-paid-704-20260710T115915Z.db`, SHA-256 `2e3a1602249b94ae17fad6ae41a7ea22afe5d88ac683b96b56f97122c7caa610`, `quick_check=ok`; valid 17-node/30-edge graph; queue empty; media jobs 636; 969.6 credits; estimated 40 credits / $0.20; eight intended image/save nodes enabled through the Browser.
- Run `grun_6ed69a0a6f86`: terminal `failed` after 207.89 seconds. Environment recipe/image/save completed; Board 1 recipe/preview completed; Board 1 image failed provider moderation; nine dependent nodes skipped. Exactly two jobs submitted.
- Environment job `job_9f8e6328df4d` completed with 4,193 submitted characters and created `asset_123e29b65e70`, 2048x1152. Original: `data/outputs/2026-07-10/20260710_120617_gpt_image_2_text_to_image_job_9f8e6328df4d_output_1/original/output_01.png`.
- Board 1 job `job_7edc89e85f74` submitted 3,405 characters and two ordered refs—Character first, new Environment second—then failed with the provider's generic policy message. Boards 2/3 never submitted.
- Credits ended at 959.6, 10 lower; media jobs ended at 638 with zero queued/running. The failed Board 1 job did not visibly deduct an additional 10 credits.
- Full-resolution Environment verdict: PASS for the fixed red/cream ship, orthographic and overhead consistency, hangar landmarks/routes, open ramp, service panel, fuel/coolant/status anchors, explicit ramp/corridor/cockpit transition, adjacent pilot/cat chairs, harnesses, materials, lighting key, and takeoff path. Minor issues: some small labels are imperfect and `Hangar Bay 7` is invented.
- Storyboard verdict: UNPROVEN. No new board image exists, so cross-board visual/layout/metadata consistency cannot be scored.
- Moderation analysis: the submitted prompt contains covered-wardrobe and neutral non-sexual guards, but actual `@image1` repeatedly shows a bare midriff/cropped suit and private `SADI / AGE 26` text. This visual/prompt conflict is the strongest observed contributor, not a proven provider root cause. The prompt also contains one unintended sanitized dialogue line, `the character's not on the manifest`, which is a content-quality defect but not proven moderation evidence.
- Safe closure: all eight paid/save nodes were changed through the Browser to UI `Mute` and saved as execution mode `frozen`; queue is empty; all 266 non-target workflow hashes match the pre-paid backup; no second Run click occurred.

### 2026-07-10 - Phase 7 plan and GRAPH-702 preparation

- Refined execution contract: SPEC-011 through SPEC-015 split the 45-second story into loading/inspection, burnt-capacitor repair, and boarding/cockpit/launch boards; the recipe, not ad hoc fields, owns the fixed 3x2 layout and production-note schema.
- Environment decision: one updated environment sheet owns two physically connected zones—hangar and cockpit—plus the ramp/corridor transition. The same output remains `@image2` for all three boards.
- Backup: `data/backups/media-studio-backup-20260710T103717Z.db` before workflow mutation.
- Browser preparation: edited only existing Prompt Recipe and Save Image fields in `Sadis Adventures`; no node, edge, public port, recipe source, or provider setting changed. All four save nodes now target Sadi.
- Isolation: target workflow changed from hash `12737ae891ddee5c8ccbdf6513219bbf27659bc842ba6950a18fb92d64738d09` to `ca2fc66eb85dbde94b0f8c9e6ddc40a88d8c935eb93169f3139ee7f6c1fc41`; the combined hash of all 266 non-target workflows stayed `7cca868ae7e30838f25235d5fec7ab2eb7ab78985bea6226888baa0a4d864bed`.
- Graph gate: 17 nodes / 30 edges, saved validation `valid=true` with zero errors/warnings, eight paid/save nodes muted, browser estimate approximately 0 credits / $0, queues empty, and media-job baseline 636.
- Duplication check: reused the existing four recipe, four GPT Image 2, four Save Image, reference, and preview nodes; no duplicate graph lane, route, component, helper, or service was added.

### 2026-07-10 - VERIFY-703 first run: deterministic compaction failure

- Browser run `grun_c50b03202bd0` completed Environment -> Board 1 -> Board 2 -> Board 3 recipe/preview order with all eight paid/save nodes muted; media jobs remained 636.
- Raw outputs: Environment 6,890; Board 1 8,786; Board 2 11,363; Board 3 12,832 characters.
- Local shaping replay: Environment 4,192; Board 1 3,541; Board 2 3,808; Board 3 3,875 characters. All fit the 4,200 target and preserve the two-zone environment, six ordered panels, reference roles, Board 2 dialogue, Bolts, harness, cockpit, hangar doors, and final quote.
- Failed contract: the shaper requests a generic `CAMERA / ACTION / DIALOGUE / SFX / CONTINUITY` system, emits abbreviated `CAM / ACT / DIALOGUE / CONT`, and drops exact `FRAMING`, `MOTION`, `DIALOG`, and `NOTES` labels. Board 1 also loses explicit service-robot, supply, landing-gear, hull-seam, and status-light wording.
- Decision: block paid execution, open BUG-706, preserve the recipe-owned seven-row schema under the existing prompt budget, and rerun the browser gate. No provider job or credit was consumed.

### 2026-07-10 - BUG-706 exact recipe-owned production-note preservation

- Red: the new Phase 7 fixture preserved story terms but failed because shaped panels emitted abbreviated labels and omitted `FRAMING`/`MOTION`; `1 failed, 152 deselected`.
- Green behavior: every panel capsule now emits `SHOT`, `CAMERA`, `FRAMING`, `ACTION`, `MOTION`, `DIALOG`, and `NOTES` in that exact order, including blank rows; the generic conflicting SFX/CONTINUITY side-section request was removed; exact user-requested dialogue may contain a requested name while other visible labels remain neutral.
- Phase 7 replay: Environment 6,890 -> 4,192; Board 1 8,786 -> 3,697; Board 2 11,363 -> 3,922; Board 3 12,832 -> 3,643 chars. Storyboards retain six ordered panels, exact role references, required story actions/dialogue/final handoff, safety language, and six copies of every required row label.
- Gates: focused fixture `1 passed, 152 deselected`; all shaper cases `9 passed, 144 deselected`; full `apps/api/tests/test_graph_studio.py` `153 passed in 78.88s`; `py_compile` and `git diff --check` pass.
- Scope: only `prompt_shaping.py`, focused tests, and engineering records changed; no recipe, node definition, public port, workflow, provider, pricing, or paid state changed during BUG-706.

### 2026-07-10 - VERIFY-703 second run: alternate heading and title drift

- Browser run `grun_6dc068e95249` completed 9 local/preview nodes with 8 muted skips, no failed run node, and media jobs unchanged at 636.
- Environment passes: raw 5,340 -> shaped 4,176 chars and retains hangar, cockpit, ramp/corridor, adjacent cat chair, robot/service-panel lanes, and hangar exit geography.
- New parser finding: all three storyboards use `Panel 01 image —` through `Panel 06 image —`. That exact hybrid is not normalized by the existing `CELL NN —`, `SHOT NN image —`, or `PANEL NN:` paths, so shaping falls back to generic truncation and returns zero capsules/row-label sets despite correct raw content.
- New content finding: Board 3 contains the correct boarding, cockpit, cyborg cat, harness, launch, and exact Bolts line, but its title copied `THE BURNT-OUT CAPACITOR — BOARD 3 OF 3` from Board 2 instead of the requested boarding-and-launch title.
- Decision: no paid execution. Open BUG-707 for the bounded heading variant and GRAPH-708 for the Board 3 title instruction, then rerun the no-paid gate. No credits were consumed.

### 2026-07-10 - BUG-707 and GRAPH-708 alternate-heading/title repair

- Red: the exact `Panel NN image —` fixture was classified as generic compaction and produced no capsules; after heading normalization it exposed the second red condition, missing explicit quoted-title extraction.
- Green: `_looks_like_storyboard_prompt` and the existing capsule parser now accept only the bounded optional `image` heading form, and `titled “...”` is preserved as the compact title/header. The seven exact metadata labels, six-panel order, dialogue, roles, safety guard, and <=4,200 budget remain intact.
- Exact second-run replay after BUG-707: Environment 5,340 -> 4,176; Board 1 10,586 -> 3,617; Board 2 13,656 -> 3,808; Board 3 14,814 -> 3,853 chars, with six panels and six copies of all seven exact labels on every storyboard.
- GRAPH-708: Board 3 continuation brief now explicitly requires `BOARDING AND LAUNCH — BOARD 3 OF 3` and forbids Board 2 title/footer reuse. Saved workflow remains 17 nodes / 30 edges and eight muted paid/save nodes.
- Gates: live-heading fixture green; all shaper cases `10 passed, 144 deselected`; full `apps/api/tests/test_graph_studio.py` `154 passed in 76.18s`; `py_compile` and `git diff --check` pass.

### 2026-07-10 - BUG-501 CELL continuity and safety hardening

- Task: BUG-501 complete under `engineering-guardrails`; no provider submission, retry, or Seedance job was authorized or performed.
- Red evidence: the exact Phase 5 `CELL NN` fixture initially misclassified Board 1 as an environment prompt and dropped Board 2 segment-three content. Follow-up red checks exposed explicit-action truncation and blank `DIALOG` absorbing `NOTES`.
- Implementation: storyboard detection now wins over incidental environment wording; `CELL NN` headings normalize into bounded ordered panel capsules; explicit `ACTION`, dialogue, notes, scene context, and final handoffs survive shaping; a covered-wardrobe and neutral non-sexual framing guard is added at the provider-prompt boundary.
- Exact captured prompt replay: Board 1 raw 8,718 -> shaped 3,488 chars and Board 2 raw 11,899 -> shaped 3,456 chars. Both retain panels 01-06 in order, the requested inspection/upgrade or boarding/cockpit/storm/destination beats, final handoff, safety language, and no `dialogue: notes` bleed.
- Regression: the two new fixtures pass (`2 passed, 150 deselected`); all prompt-shaper cases pass (`8 passed, 144 deselected`); full `apps/api/tests/test_graph_studio.py` passes (`152 passed in 80.56s`); `py_compile` and `git diff --check` pass.
- Browser proof: in-app Browser run `grun_79f3d6936f53` completed from the 17-node / 30-edge `Sadis Adventures` graph. Nine local/preview nodes completed, all four GPT Image 2 plus four Save nodes stayed muted, no node failed, estimate stayed approximately 0 credits / $0, and media jobs remained 636.
- Boundary: this proves deterministic prompt preservation and no-paid graph wiring. It does not prove provider acceptance or cross-board visual consistency; a second paid proof still requires separate action-time approval.

### 2026-07-10 - Phase 5 paid proof: partial improvement, terminal Board 2 failure

- Tasks: PAID-501 attempted; VERIFY-502 completed with a failed campaign verdict.
- Action-time approval: granted in the 2026-07-10 user request for one paid run.
- Backup: `data/backups/media-studio-backup-20260710T054120Z.db`.
- Preflight: 989.62 credits available; exact graph estimate 40 credits / $0.20; 17 nodes / 30 edges; validation valid with zero errors/warnings; four GPT Image 2 nodes; no Seedance node.
- Paid run: `grun_06e79a352e9f`, terminal `failed` after 395.34 seconds with 11 completed, 1 failed, and 5 dependency-skipped nodes.
- Paid side effects: three image jobs were submitted. Environment `job_65c502232b8d` and Board 1 `job_2e08d11c55e8` completed; Board 2 `job_952f57817b16` failed with `Sorry, but the image we created may violate OpenAl's content policies.` Board 3 never submitted. Credits ended at 969.62, exactly 20 credits lower.
- New assets: Environment `asset_c32387090bc8`; Board 1 `asset_8e7579450185`. Board 2/3 have no new assets.
- Safety closure: no second run, no video/Seedance job, and all four KIE image plus four save nodes were restored to `muted`; the clean saved canvas reports approximately 0 credits / $0.

| Review dimension | Verdict | Evidence |
|---|---|---|
| Dependency order | PASS until provider failure | Environment recipe/image/save completed before Board 1; Board 1 recipe/image/save completed before Board 2; Board 3 was dependency-skipped after Board 2 failed. |
| Environment continuity sheet | IMPROVED | The new 2048x1152 sheet has one fixed red/cream ship, camera-right ramp, blue diagnostic wall, amber doors, readable action lanes, orthographic views, an overhead map, and explicit continuity anchors. |
| Character identity / wardrobe | PARTIAL | Board 1 keeps a consistent face, hair, cyborg limbs, and red/cream materials across six panels, but rear views drift toward more exposed lower-body styling than the approved character sheet. This is a likely moderation risk, not a proven provider root cause. |
| Layout system | IMPROVED BUT INCOMPLETE | New Board 1 uses the intended dark near-black/yellow-orange six-cell production-board system and removes the baseline Board 2 `GPT IMAGE 2` header leak. No new Boards 2/3 exist, so cross-board layout consistency remains unproven. |
| Story causality | FAIL | The raw Board 1 recipe contained all six requested body-upgrade checks and the ready-for-next-adventure ending, but the submitted 3,522-character prompt retained none of `modified`, `inspect`, `ready`, or `adventure`; the image instead invents PILOT/SYSTEM/RELAY checks and boarding. Board 2 submitted 3,936 characters but retained only `launch`, dropping `cockpit`, `storm`, and `destination`. |
| Metadata / forbidden text | PARTIAL PASS | New Environment and Board 1 contain no private `Sadi`, provider, or model name. Metadata is legible, but the generated sheet still invents dates/version/technical values, and Board 1's neutral IDs describe the wrong story. |
| Final handoff | FAIL / UNPROVEN | Board 1 ends by ascending the ramp rather than the requested spoken ready state; Board 2 failed; Board 3 did not run. |
| Provider safety | FAIL | Board 2 image-to-image was rejected after 39.05 seconds; downstream nodes correctly skipped and no automatic retry occurred. |

Deterministic root cause: the live Prompt Recipe output used `CELL NN — <full action>` blocks followed by short `SHOT:` metadata lines. Current compaction recognizes `SHOT`/`PANEL` forms but does not preserve the preceding `CELL` action blocks, so required story beats were removed before provider submission. Recommended next task: BUG-501, add a red fixture for `CELL NN` output, preserve the six action/dialogue capsules and final handoff, and add policy-safe covered-wardrobe/non-sexual framing guards before any newly approved paid proof.

Original outputs:

- Environment: `data/outputs/2026-07-10/20260710_054437_gpt_image_2_text_to_image_job_65c502232b8d_output_1/original/output_01.png`
- Board 1: `data/outputs/2026-07-10/20260710_054731_gpt_image_2_image_to_image_job_2e08d11c55e8_output_1/original/output_01.png`

### 2026-07-10 - Post-campaign runtime sanity

- The existing Chrome tab initially returned `ERR_CONNECTION_REFUSED`; the standard development launcher was restarted on API `:8000` and web `:3000` with persistent data preserved.
- Final live health: API `status=ok`, embedded runner `healthy` and active, zero queued/running jobs, no health issues, and Graph Studio HTTP 200.
- Chrome reloaded Media Studio successfully and rendered the target canvas with 30 React Flow edges and the completed 194.2-second / 17-node run summary. The authoritative saved workflow remained 17 nodes / 30 edges, server-valid with zero errors/warnings, with four Prompt Recipes pinned to Codex Local and every KIE model/save branch muted.
- No provider run was triggered during this sanity check.

### 2026-07-10 - BUG-401B/401C and final Phase 4 browser proof

- Tasks: BUG-401B, BUG-401C, VERIFY-401, VERIFY-402.
- Final no-paid run: `grun_b30f605b84b9`, completed 17/17 nodes in 194.23 seconds with `actual_cost_usd = 0.0`.
- Safety result: media jobs remained 633; the newest media job is still `job_b17b4561565e` from 2026-07-09. No Seedance node or job was present.

| Command or check | Result | Notes |
|---|---|---|
| Continuation prompt run before BUG-401B | REPRODUCED | Board 2 disconnected three times before token usage when Prompt Recipe vision supplied three original 2048x1152 assets; media jobs stayed 633. |
| Current local provider probe | PASS | `gpt-5.6-sol` connected and image-capable; no media job. Selected workflow Prompt Recipes now explicitly use this verified local model. |
| Bounded Prompt Recipe vision context | PASS | Existing web derivatives (~240-308 KB for the relevant generated assets) are used only for Prompt Recipe vision; downstream KIE model refs remain the original assets. Focused red/green plus 15 Prompt Recipe tests pass. |
| Continuation-only browser proof | PASS | `grun_4d35a7e95a1f` completed Boards 2/3 with three ordered refs after BUG-401B; no media job. |
| Final full browser run order | PASS | Environment 05:12:57-05:13:30 -> Board 1 05:13:30-05:14:14 -> Board 2 05:14:14-05:15:15 -> Board 3 05:15:15-05:16:11 UTC. Dependency edges, not sleeps/titles/positions, established order. |
| Final visible prompt previews | PASS | All four Display Any nodes completed. Storyboards visibly show @image1 Character and @image2 Environment; Boards 2/3 show @image3 prior board. Board 1 ends “next adventure”; Board 2 retains cockpit/launch/storm/destination; Board 3 retains distress/relay/signature/station/shadow. |
| Final submitted-prompt audit | PASS | Raw -> shaped chars: Environment 5,207 -> 4,185; Board 1 8,959 -> 3,021; Board 2 12,020 -> 3,450; Board 3 12,173 -> 3,445. All <=4,200 and below the 20,000 hard limit. |
| Contamination and visible-text audit | PASS | Storyboards contain no freeze-trigger/state-machine contamination, private `Sadi` name, OpenRouter/Codex Local name, or GPT Image 2 provider name. Environment contains only its intentional negative no-time-freeze exclusion. |
| Live SHOT/DIALOG compaction | PASS | `SHOT NN image` headings normalize into all six panel capsules; `DIALOG` alias and the ready-for-next-adventure ending survive. Regression is green. |
| Preview retention | PASS | All four KIE model and four Save nodes are `skipped/muted`, `cached=1`, `carried_forward=1` from `grun_a97f4b9ac07d`; four prior thumbnails remain visible in the browser. |
| Retained assets | PASS | Environment `asset_d4ab90a294ae`; Boards 1-3 `asset_199a95569540`, `asset_a523dece2157`, `asset_b3333ad9da1c`. |
| Browser canvas | PASS | Clean saved tab, 17 nodes, 30 rendered edges, graph estimate ≈0 credits / $0, current run summary 194.2s and 17 completed nodes. |
| Full backend target | PASS | `apps/api/tests/test_graph_studio.py`: 150 passed in 82.65 seconds. |
| Focused web hydration + typecheck | PASS | 9 Vitest checks; `tsc --noEmit`; `git diff --check` pass. |
| Mutation isolation | PASS | All 266 non-target workflow JSON records unchanged from backup; workflows 267, runs 678, assets 582, media jobs 633. |

### 2026-07-10 - BUG-401A saved dynamic-workflow hydration

- Task: BUG-401A, discovered by VERIFY-401 preflight.
- Behavior change: manually opening a saved workflow containing `prompt.recipe` or `preset.render` now refreshes data-backed node definitions before current-contract edge filtering.

| Command or check | Result | Notes |
|---|---|---|
| First prompt-only Run click | SAFELY BLOCKED | No graph-run or media-job row was created. Preflight reported Board 2/3 had no required image reference. |
| Browser/SQLite edge comparison | FINDING | Saved workflow had 30 edges, but the stale hydrated canvas rendered 22; Run auto-saved the 22-edge copy before validation. |
| Selected-workflow recovery | PASS | Closed the stale tab, restored only the eight typed recipe edges through the Graph workflow API, and revalidated the 30-edge workflow. Runs remained 673 and media jobs 633. |
| Focused regression red/green | PASS | New async definition-refresh test failed before implementation, then passed; dynamic definition plus hydration selections are 9/9 green. |
| Web typecheck | PASS | `tsc --noEmit`. |
| Browser reopen after fix | PASS | Clean saved tab renders 30 React Flow edges, 3 Character Ref labels, 4 Environment Ref labels, 2 Additional Refs labels, 8 muted media surfaces, and graph estimate ≈0 credits / $0. |
| Saved workflow validation | PASS | Server validation returns `valid: true`, zero errors, zero warnings. The one visible optional-image warning belongs only to the Environment recipe, which intentionally has no reference input. |
| Provider submissions | PASS | No image/video job created; media-job count remained 633. |

### 2026-07-10 - BUG-301 story-specific prompt shaping

- Task: BUG-301.
- Behavior change: GPT Image 2 storyboard compaction classifies freeze behavior from labeled `USER STORY BRIEF` / `CONTINUATION BRIEF` content when available, preventing generic conditional recipe guidance from contaminating unrelated stories. Unlabeled prompts preserve the previous whole-prompt fallback.

| Command or check | Result | Notes |
|---|---|---|
| Two BUG-301 regression fixtures | PASS | 2 passed, 146 deselected; non-freeze contamination removed and positive state order retained. |
| Focused TEST-002 graph gate | PASS | 8 passed, 140 deselected; shaping, typed-role visibility, dependency order, and muted carry-forward green. |
| Seed recipe contract | PASS | 1 passed. |
| Focused assistant graph construction | PASS | 8 passed, 340 deselected. |
| Full `test_graph_studio.py` first run | FINDING | 145 passed, 3 stale smoke fixtures failed because they still wired typed built-in recipes through retired generic `image_refs`. |
| Typed smoke-fixture correction | PASS | Character uses `character_ref`, Environment uses `environment_ref`, and previous board uses `additional_refs`; exact three-test rerun passed. |
| Full `test_graph_studio.py` rerun | PASS | 148 passed in 82.26 seconds. |
| Prompt budget and metrics | PASS | Existing strategy and exact length metrics remain unchanged; compact target remains <=4,200 and hard limit remains 20,000. |
| Provider submissions | PASS | Tests used fakes only; zero image/video provider jobs. |

### 2026-07-10 - BUG-202 selected-workflow repair

- Task: BUG-202.
- Behavior change: only `graphwf_4fd06f50c493` was updated from 17 nodes/24 edges to 17 nodes/30 edges with typed recipe inputs, immediate previous-board visual handoffs, exact GPT reference order, and muted provider/save nodes.
- Backup: `data/backups/media-studio-before-graphwf_4fd06f50c493-20260710_111622.db`, SHA-256 `432b0160daaf2a97c007c77d74d9055b335154b0fa327daf409d853327930954`, SQLite `quick_check` OK.

| Command or check | Result | Notes |
|---|---|---|
| Backup checksum and SQLite integrity | PASS | Restorable baseline captured before mutation. |
| First interactive repair attempt | RECOVERED | Input corruption partially committed; the selected record only was immediately restored from backup and its original 17-node/24-edge hash reverified before the structured repair. |
| Targeted built-in recipe-row sync | PASS | Only Storyboard v2 2.11 and Storyboard Continuation v1 1.6 were synchronized; all other prompt-recipe rows were hash-identical. No broad seed refresh ran. |
| Workflow validation and exact-edge inspection | PASS | 17 nodes, 30 edges; Character is ref 1, Environment ref 2, prior board ref 3 on Boards 2/3; text handoffs remain dependency edges. |
| Workflow isolation diff | PASS | All 266 other workflow hashes unchanged; counts remained workflows 267, graph runs 673, assets 582, jobs 633. Node IDs, positions, and prior media fields were preserved. |
| In-app browser typed-port and visual wiring check | PASS | Saved canvas shows 3 Character Ref labels, 4 Environment Ref labels, 2 Additional Refs labels, prior-board ref-3 badges, 8 muted provider/save nodes, and graph estimate ≈0 credits / $0. |
| Generic recipe help warning | RESIDUAL | Four recipe nodes still render generic “no images are connected to Image References” help despite visible typed ports/badges and validated persisted edges; no UI source was changed because this is outside BUG-202. |
| Provider submissions | PASS | No image/video run was started; Seedance absent and untouched. |

### 2026-07-10 - BUG-201 canonical graph construction

- Task: BUG-201.
- Behavior change: storyboard graph plans add/reuse one saved Environment dependency and connect Character, Environment, previous prompt, and previous board image through exact typed/ordered edges. Runtime scheduling code was not changed.
- Public interface change: none; existing nodes, ports, operations, and groups are reused.

| Command or check | Result | Notes |
|---|---|---|
| Media Assistant storyboard/continuation selection | PASS | 10 passed, 338 deselected. The three-board fixture validates and compiles. |
| Canonical dependency scheduler characterization | PASS | 1 passed, 147 deselected. Ordering remains edge-derived. |
| Seed recipe contract | PASS | 1 passed. |
| Duplication search for Environment branch | PASS | One implementation path in `story_graph.py`; no parallel helper/service added. |
| `git diff --check` | PASS | No whitespace errors. |
| Provider submissions | PASS | Zero image/video jobs; Seedance untouched. |

### 2026-07-10 - BUG-101 recipe continuity contract

- Task: BUG-101.
- Behavior change: Storyboard v2 version 2.11 declares `character`/`environment`; Storyboard Continuation version 1.6 declares `character`/`environment`/`additional`, uses the canonical reference order, and shares the stable 16:9 board-system/visible-text contract.
- Public interface change: no new port, route, schema, or dependency; recipe-specific generic ports are replaced by existing declared typed roles as specified.

| Command or check | Result | Notes |
|---|---|---|
| `pytest apps/api/tests/test_store_seed_data.py` | PASS | 1 passed. |
| Typed prompt-recipe/reference selection | PASS | 3 passed, 145 deselected. |
| Assistant storyboard/continuation selection | EXPECTED RED | 9 passed, 1 failed only because BUG-201 has not added the Environment branch. |
| `git diff --check` | PASS | No whitespace errors. |
| Provider submissions | PASS | Zero image/video jobs; Seedance untouched. |

### 2026-07-10 - TEST-002 contract-first regression gate

- Task: TEST-002.
- Scope: tests and review artifacts only; no application source, workflow data, provider job, or paid side effect changed.

| Command or check | Result | Notes |
|---|---|---|
| Campaign-scoped pre-implementation `code-review` | PASS | Required artifacts created under `docs/reviews/20260710_105425/`; 3 high and 2 medium campaign findings; security/access/API reports recorded evidence-backed N/A. |
| Graph focused baseline before test edits | PASS | 3 passed, 142 deselected. |
| Seed focused baseline before test edits | PASS | 1 passed. |
| Assistant focused baseline before test edits | FINDING | 5 passed, 5 failed; failures traced to stale generic-port expectation plus undeclared `additional_refs`. |
| Graph TEST-002 selection after test edits | EXPECTED RED | 4 passed, 3 failed: typed role visibility, non-freeze contamination, exact freeze-state order. Dependency scheduling and existing correct shaping/retention checks passed. |
| Seed TEST-002 selection after test edits | EXPECTED RED | 1 failed at missing Storyboard v2 `reference_roles`. |
| Assistant TEST-002 selection after test edits | EXPECTED RED | 6 passed, 4 failed at undeclared continuation `additional_refs`; custom typed-role fixture and existing correct cases pass. |
| `git diff --check` | PASS | No whitespace errors. |
| Provider submissions | PASS | Zero image/video jobs; Seedance untouched. |

### 2026-07-10 - Planning baseline

- Task: pre-implementation audit and handoff creation.
- Commit/diff context: broad pre-existing dirty worktree; documentation-only changes made in this pass.

| Command or check | Result | Notes |
|---|---|---|
| `git status --short` | PASS | Confirmed broad dirty tree; no unrelated files reverted. |
| SQLite query of `graphwf_4fd06f50c493` | PASS | `Sadis Adventures`: 17 nodes, 24 edges. |
| SQLite query of `grun_a97f4b9ac07d` | PASS | Completed, 17/17 nodes, environment plus three storyboard assets. |
| Inspect current workflow edges | FINDING | Environment save reaches each GPT model but no storyboard recipe. |
| Inspect current workflow edges | FINDING | Prompt 1 -> recipe 2 and prompt 2 -> recipe 3 exist; prior storyboard image handoffs do not. |
| Inspect current workflow edges | FINDING | Character reaches storyboard recipes through generic `image_refs`. |
| Inspect paid model input snapshots | FINDING | Non-time-freeze orbital prompts received time-freeze continuity text after compaction. |
| Inspect KIE local model spec | PASS | GPT Image 2 I2I allows 1-16 images and 20,000 prompt characters. |
| Initial API/web curl | RECOVERED | Servers were initially down; existing `npm run dev:api` and `npm run dev:web` commands were started. |
| API `/health` and web `/graph-studio` | PASS | Both returned HTTP 200 after startup. |
| In-app browser Graph Studio baseline | PASS | Loaded `Sadis Adventures`; no graph run or paid submission triggered. |
| Browser current-run summary | PASS | Displayed 876.4s, 17 completed nodes, and 5 output assets. |
| Browser recipe-port inspection | FINDING | Storyboard recipes show generic `Image Refs`; Environment Sheet declares `Environment Ref`, but no environment-to-storyboard-recipe connection is present. |
| Browser model-reference inspection | FINDING | Environment save appears as image reference 2 on all three storyboard GPT nodes. |
| Browser preview retention baseline | PASS | Existing recipe outputs and 2048x1152 generated image previews remained visible on load. |
| `git diff --check` before docs | PASS | No whitespace errors in existing dirty diff. |

## Phase 13 durable trilogy acceptance and subsystem review

Date: 2026-07-11

| Check | Result | Evidence |
|---|---|---|
| New deterministic quality tests | PASS | 4 focused tests pass; the gate first caught and then verified fixes for Board 1 distance and early-cat negative phrasing. |
| Full focused + Graph Studio target | PASS | 176 passed in 92.55s before provider submission. |
| Zero-cost browser audit | PASS | `grun_4319c5f1170a`; media jobs unchanged at 663; manifest deterministic gate passes. |
| Paid trilogy | COMPLETE | `grun_9e02c78b4ce0`; three completed jobs/assets at 2048x1152; balance 719.6 -> 689.6; 30 credits / $0.15. |
| Paid deterministic manifest | PASS | `data/quality-manifests/grun_9e02c78b4ce0.json`; all ten deterministic gates pass. |
| Original-resolution visual review | NOT ACCEPTED | Shared layout/cinematic/Environment/character/story/Bolts/dialogue strengths pass; strict failures are Board 3 `DIALOS`, early-open Board 1 service bay, and incomplete Board 3 lift/Bolts proof. |
| Paid retry | NOT RUN | Phase 13 authorized exactly one complete paid trilogy. |
| Final baseline | PASS | Six Board GPT/Save nodes frozen back to Phase 12 best `grun_e39207d96114`; Character and Environment unchanged. |
| Uber subsystem review | COMPLETE | `docs/reviews/20260711-173000-recipes-presets-media-assistant.md`; 2 High, 2 Medium, 8 handoff tasks. |
| Focused backend review tests | FAIL / BLOCKER | 343 passed, 9 failed in 104.97s. Failures are documented in CR-001 through CR-003 and Phase 14 tasks. |
| Focused frontend review tests | PASS | 4 files / 94 tests passed. |
| Seedance | PASS | No video node enabled or provider job submitted. |

## Phase 15 adjacent-board visual handoff proof

Date: 2026-07-11

| Check | Result | Evidence |
|---|---|---|
| Backup | PASS | `data/backups/media-studio-before-phase15-20260711.db`; SHA-256 `8e94f93a4148c4e2f087f24cea772c0453ff69b565065f388ea30bf902167c67`; `quick_check=ok`. |
| Focused/full relevant tests | PASS | 177 passed in 100.70s. |
| Zero-paid prompt run | PASS | `grun_8d21c7ba504f`; media jobs unchanged at 666. |
| Exact prompt replay | PASS | 3,784 / 3,927 / 4,182 chars; all eleven deterministic gates pass, including D011 handoff match. |
| Paid trilogy | COMPLETE | `grun_96397a59122a`; three jobs/assets at 2048x1152; credits 689.6 -> 659.6; 30 credits / $0.15. |
| Board 1 P06 -> Board 2 P01 | PASS | Near-identical 50mm eye-level camera, framing, pilot/hand placement, closed amber panel, ship/ramp/background, lighting, and color; latch release is the only new action. |
| Board 2 P06 -> Board 3 P01 | PASS | Near-identical 50mm eye-level camera, framing, pilot/hand placement, closed green panel, ship/ramp/background, lighting, and color; turn toward ramp is the only new action. |
| Overall visual gate | NOT ACCEPTED | PAGE 1 OF 1 on all boards; Board 1 lacks Board 2/3 number badges; exposed waist; humanoid Bolts; ambiguous lift. |
| Final baseline | PASS | Six Board GPT/Save nodes frozen to Phase 12 best `grun_e39207d96114`; valid 17/30; queue empty; Character/Environment unchanged. |
| Retry / Seedance | PASS | No retry and no video job. |

## Paid Baseline Assets

| Role | Asset | Original file |
|---|---|---|
| Environment | `asset_d4ab90a294ae` | `/Users/evilone/Documents/Development/Video-Image-APIs/media-studio/data/outputs/2026-07-09/20260709_130356_gpt_image_2_text_to_image_job_f93c02f656c2_output_1/original/output_01.png` |
| Storyboard 1 | `asset_199a95569540` | `/Users/evilone/Documents/Development/Video-Image-APIs/media-studio/data/outputs/2026-07-09/20260709_130737_gpt_image_2_image_to_image_job_7048b88dc388_output_1/original/output_01.png` |
| Storyboard 2 | `asset_a523dece2157` | `/Users/evilone/Documents/Development/Video-Image-APIs/media-studio/data/outputs/2026-07-09/20260709_131054_gpt_image_2_image_to_image_job_e8180834b6d1_output_1/original/output_01.png` |
| Storyboard 3 | `asset_b3333ad9da1c` | `/Users/evilone/Documents/Development/Video-Image-APIs/media-studio/data/outputs/2026-07-09/20260709_131341_gpt_image_2_image_to_image_job_b17b4561565e_output_1/original/output_01.png` |

## Residual Risk

- The latest saved workflow can differ from the historical paid-run snapshot if the user edits it before implementation starts; refresh the captured baseline before TEST-002 if its update timestamp changes.
- Visual layout consistency remains probabilistic even after prompt/reference corrections; Phase 5 uses a rubric and one-run gate.

## Phase 8 BUG-712 / PAID-713 / BUG-714 Evidence

Date: 2026-07-10

| Check | Result | Evidence |
|---|---|---|
| Existing character-asset search | PASS with variance | No fully covered private-text-free sheet existed. Selected neutral same-identity imported portrait `ref_3c38d161cdc3`; no new character provider job was created. |
| Character workflow mutation | PASS | Only `media.load_image-68b1143e` changed from `asset_901adc9b21d1` to `ref_3c38d161cdc3`; target remained 17 nodes / 30 edges. |
| Environment reuse | PASS | Environment GPT/Save explicitly frozen to `grun_6ed69a0a6f86`; downstream output is `asset_123e29b65e70`. |
| Final no-paid run | PASS | `grun_cb78cbc5ec4b` completed; Environment nodes cached; all board GPT/save nodes skipped; media jobs stayed 638; queue stayed empty. |
| Raw prompt audit | PASS | No private name, `the character's not on the manifest`, `do not the character`, `never the character`, or negative-action contamination. |
| Submitted-prompt replay | PASS | Board 1 3,391 chars; Board 2 3,756; Board 3 3,687. Each contains six SHOT/CAMERA/FRAMING/ACTION/MOTION/DIALOG/NOTES rows; ordered references and exact requested dialogue survive. |
| Full Graph Studio API test | PASS | 163 passed in 81.09 seconds after BUG-714. |
| Python compilation | PASS | `prompt_ops.py` and `prompt_shaping.py` compile. |
| `git diff --check` | PASS | No whitespace errors in scoped source/tests/docs. |
| PAID-713 preflight | PASS | Valid 17/30; only six Board GPT/save nodes enabled; Environment frozen; estimate 30 credits / $0.15; credits 959.6; no Seedance. |
| PAID-713 run | TERMINAL FAIL | `grun_b005f9a1dbf8` failed at Board 1; `job_02c012a45027` provider moderation; Boards 2/3 dependency-skipped. |
| Paid reference order | PASS | Submitted reference 1: `reference-media/images/fb98ac1d...jpg`; reference 2: Environment `...job_9f8e6328df4d.../output_01.png`. |
| Paid cost/queue closure | PASS | Credits remained 959.6; media jobs 639; queued/running jobs 0; no Board 2/3 job. |
| Exact failed-prompt replay after BUG-714 | PASS | 3,528 chars; six complete panels/seven rows; both ordered refs; all inspection beats; positive-only workwear/framing; observed negative moderation terms absent. |
| Non-target workflow isolation | PASS | 266 workflows retain SHA-256 `7cca868ae7e30838f25235d5fec7ab2eb7ab78985bea6226888baa0a4d864bed`. |
| Final execution state | PASS | Board 1-3 GPT/save nodes muted; Environment GPT/save frozen to the successful cached run; target validates with zero errors/warnings. |

Browser defects observed during BUG-712:

- Character `Replace` produced no scoped selector; global imported-image selection created an unconnected 18th Load Image node. Both attempts were undone immediately.
- Explicit saved frozen cache state hydrated as Muted in Graph Studio, so no-paid and paid runs used the saved workflow API fallback to preserve `cached_run_id`.
- These defects are scoped as BUG-715. They did not change another workflow or cause an extra provider submission.
## Phase 16 input-driven adjacent-but-distinct proof

Date: 2026-07-12

| Check | Result | Evidence |
|---|---|---|
| Backup/isolation | PASS | `data/backups/media-studio-before-phase16-20260712.db`; SHA-256 `7a240437ede08a096e8f0f04f36b0abdef79db42324524e4ba9d39365fdf3fbe`; `quick_check=ok`; non-target workflow hash unchanged during scoped mutation. |
| Focused backend | PASS | 179 passed in 81.73s. |
| Zero-credit browser gate | PASS | `grun_b0b8fc718710`; 11/11 deterministic checks; 3,190 / 4,137 / 4,100 chars; media jobs stayed 669. |
| Paid trilogy | COMPLETE | `grun_d7da4a50b807`; three completed 2048x1152 jobs/assets; credits 659.6 -> 629.6; 30 credits / $0.15. |
| Layout/footer | PASS | All sheets use the same header, top production strip, numbered 3x2 grid, borders, metadata proportions, row order, palette, and no footer. |
| Dialogue attribution | PASS | Board 2 visibly labels DROID `[dry synthetic voice]` and PILOT `[wry amused voice]`; Board 3 labels PILOT `[warm adventurous voice]`. |
| Environment/story flow | PASS | Same ruined hangar/ship treatment; walk-up -> inspection -> repair -> ramp/cockpit -> lift/departure is causally readable. |
| Board 1 P06 -> Board 2 P01 | PASS | Same amber-panel state with a new latch action and lower three-quarter shot. |
| Board 2 P06 -> Board 3 P01 | FAIL | Metadata advances to a step/shoulder angle, but the rendered frame remains too close to the prior green-panel composition. |
| Character/Bolts | FAIL | Exposed waist remains; Board 3 renders a humanoid robot instead of a small feline cyborg cat. |
| Final state | PASS | Six Board GPT/Save nodes frozen to `grun_d7da4a50b807`; Environment frozen; estimate 0; queue empty; no Seedance or retry. |

## Phase 18 generic recipe and user-owned remediation

Date: 2026-07-12

| Check | Result | Evidence |
|---|---|---|
| Reusable-source audit | PASS | New mandatory genericity guard initially found campaign terms in shared prompt shaping, trilogy quality, and assistant helpers; all findings were removed or replaced with user/workflow-supplied contracts. |
| Recipe contract | PASS | Storyboard v2 `2.14` and Continuation `1.9` expose `board_title` and `production_metadata` alongside handoff, dialogue, wardrobe, and subject-design cues; migration 44 refreshes built-ins. |
| Genericity gate | PASS | `scripts/check_storyboard_recipe_genericity.py` passes and is invoked by `scripts/run-quality-gates`. |
| Focused backend | PASS | Seed/migration/trilogy/assistant suite: 365 passed; full Graph Studio backend: 173 passed; prompt-shaping/trilogy selection: 32 passed. |
| Full release verification | PASS | 751 backend tests; 757 web tests; lint; typecheck; production build; Studio browser smoke; clean schema bootstrap/migration status at version 44; diff formatting. |
| Saved workflow isolation | PASS | Backup `data/backups/media-studio-backup-20260712T062743Z.db`; only the three storyboard Prompt Recipe field maps changed; graph remains 17 nodes / 30 edges, valid with zero errors/warnings. |
| Browser field hydration | PASS | Closing and reopening `Sadis Adventures` showed three distinct titles and metadata sets, both handoff advances, all dialogue/wardrobe/subject cues, eight Frozen nodes, 629.6 balance, and approximately 0 credits / $0. |
| References and spend | PASS | Existing Character and Environment references were preserved; no graph run, provider submission, media job, credit spend, or Seedance action occurred. |
| PAID-1807 execution | COMPLETE | `grun_3c59a437ce9a`; assets `asset_bf84092e3022`, `asset_b8b3fb7f749f`, `asset_ffcc8edf0d55`; three 2048x1152 boards; 30 credits / $0.15; balance 629.6 -> 599.6; no Environment or Seedance generation. |
| Layout/title/sequence | PASS | All boards use identical no-footer 3x2 geometry and metadata rows; visible titles are Board 1/2/3 and sequence values are 01/02/03. |
| Story/Board 1-to-2 | PASS | Walk-up/inspection -> diagnosis/repair -> boarding/lift remains readable; Board 1 Panel 6 and Board 2 Panel 1 preserve the closed amber panel with a new latch action. |
| Wardrobe/Bolts | FAIL | Exposed waist remains across the trilogy; Board 3 renders Bolts as a humanoid robot rather than a feline cyborg cat. |
| Board 2-to-3 handoff | FAIL | Board 2 ends close at the green repair panel, but Board 3 begins at the ramp without keeping the repaired panel visibly in the adjacent composition. |
| Production metadata | FAIL | The provider invented `STARBOARD PREP`, `MAY 18, 2025`, and `STORY TEAM` instead of the user-owned production metadata. |
| Submitted-prompt audit | ROOT CAUSE | Board titles survived, but all three final prompts omitted wardrobe/opaque/waist terms and exact production metadata; Board 3 omitted `feline` and the non-humanoid constraint. |
| BUG-1808 | PASS | Sanitizer appends six labeled user-owned directives before final compaction for both Storyboard v2 and Storyboard Continuation. Generic test values prove exact metadata, handoff, dialogue, wardrobe, and non-humanoid four-legged subject cues survive. |
| Post-fix validation | PASS | Full release: 752 backend / 757 web tests, lint, typecheck, build, Studio smoke, clean schema 44 bootstrap, genericity and formatting. Final Continuation dispatch: 16 focused / 175 Graph Studio tests. |
| Frozen reload proof | PASS | Six storyboard GPT/Save caches point to `grun_3c59a437ce9a`; zero-cost `grun_3288fa193219` completed 17/17 with media jobs unchanged at 675; fresh Browser shows the `10:10:06`, `10:13:38`, and `10:17:08` PAID-1807 images Frozen/Cached at 2048x1152 and approximately $0. |
| Live post-fix prompt proof | PASS | Browser run `grun_643471f2d8b9` completed at $0. Boards 1-3 visibly contain labeled production metadata, dialogue, wardrobe, and subject-design directives; Boards 2-3 contain handoff directives; Board 3 contains feline/non-humanoid constraints. Eight nodes remain Frozen/Cached at 599.6 credits and approximately $0. |
| Browser console | PASS with historical noise | Three update-depth errors were timestamped before the final proof began during hot reload; no new error appeared after a clean reload. |
| PAID-1810 pre-provider attempts | ZERO COST | `grun_63e4aff8eb33` and `grun_f5c84c3c4c80` stopped in Board 1's local recipe with `Reconnecting... 5/5`; media jobs stayed 675 and credits stayed 599.62. |
| BUG-1811 browser-loop fix | PASS | Failed stale catalogs no longer re-enter forced refresh. Shared/Graph provider-catalog tests pass 3/3 and web typecheck passes. |
| BUG-1812 reconnect fix | PASS | Successful terminal turn/idle state supersedes transient retry notifications; genuine failed terminal turns remain errors. Provider target passes 17/17; full image-capable App Server probe returned a provider response id. |
| PAID-1810 execution | COMPLETE | `grun_e83a12b31a07`; jobs `job_2d85928b9888`, `job_274180104029`, `job_ea0a4858439a`; assets `asset_9a1446151ab0`, `asset_d8d58a004fa5`, `asset_9a63be43b6f6`; three 2048x1152 boards; balance 599.62 -> 569.62; no Environment or Seedance generation. |
| PAID-1810 provider-bound directives | PASS | Submitted prompts retain exact Board 1/2/3 titles, production metadata, handoff advances, attributed dialogue, opaque-waist instruction, and Board 3 feline/non-humanoid anatomy lock. |
| PAID-1810 layout/environment/story | PASS with residuals | All boards use the same no-footer 3x2 production-sheet family and the same hangar/ship treatment. Board 1 walk-up, Board 2 diagnosis/repair, and Board 3 boarding are causal. Board 1 Panel 6 opens the bay early and Board 3 stops at launch prep rather than visible lift-off. |
| PAID-1810 metadata/dialogue | PASS with typo | Top-strip PROJECT/SEQUENCE/LOCATION/DATE/ARTIST values are correct and differentiated; droid and pilot dialogue is attributed and the requested Bolts line is complete. Board 2 visibly misspells `FRAMING`/`ACTION` as `FRAMRA`/`ACTING` in two cells. |
| PAID-1810 character/Bolts | PARTIAL PASS | Bolts is now an unmistakable feline cyborg cat rather than a humanoid robot. The unchanged Character reference still drives exposed-waist styling despite the preserved opaque-coverage directive. |
| Frozen browser/cache proof | PASS | Six storyboard GPT/Save caches point to `grun_e83a12b31a07`; clean Browser reload shows eight Frozen nodes and approximately 0 credits. `grun_5f1f3974594e` completed 17/17 with eight Frozen/Cached nodes, no new media jobs, 569.62 credits, and no failures. |
| Final release verification | PASS | 755 backend tests; 758 web tests; lint; typecheck; production build; Studio browser smoke; clean schema bootstrap/migration status at version 44; repo hygiene, genericity, file-size, style-drift, and diff-formatting guards. |
| Visual closure | TERMINAL PARTIAL | PAID-1810 materially improves the post-BUG-1808 proof but is not a complete visual acceptance. No further paid retry is authorized. |

## Phase 19 stacked metadata rows proof

Date: 2026-07-13

| Check | Result | Evidence |
|---|---|---|
| Recipe/runtime contract | PASS | Storyboard Director, Storyboard v2, Continuation, Food Storyboard, compact GPT Image 2 shaping, and assistant-authored Storyboard v2 recipes require one full-width metadata block with stacked horizontal rows and prohibit side-by-side columns/tables/vertical lanes. |
| Automated verification | PASS | Focused row-contract target 12/12; broader recipe/graph/assistant target 32/32; full release verification 755 backend / 758 web plus lint, typecheck, production build, Studio smoke, clean schema 44, hygiene, genericity, file-size, style-drift, and formatting gates. |
| Startup recovery guard | PASS | An incompatible historical interrupted snapshot no longer prevents API startup; full Graph Studio backend target 176/176. |
| Browser zero-credit preflight | PASS | `grun_70c7349b9dc9`; 17/17 nodes; zero provider media jobs; 569.6 credits unchanged. Boards 1-3 emitted the seven-row/no-columns contract. |
| Paid execution | PARTIAL | `grun_76a44838e61e`; Board 1 `asset_9d0be5fd5fd4`, Board 2 `asset_666a05115bcf`; both 2048x1152. Board 3 `job_6eeab65cfe5c` failed provider moderation with zero credits. Balance 569.6 -> 549.6; no retry. |
| Stacked-row visual gate | PASS on Boards 1-2 | Both successful sheets use one label/value per horizontal row and no metadata columns. Shared top strip, 3x2 grid geometry, palette, borders, and row order match. |
| Completeness/text gate | FAIL | Board 1 Panel 6 is blank, Panel 3 clips `SHOT` to `SHO`, and some values truncate. Board 2 renders all six panels and seven rows with substantially better legibility. |
| Safe closure | PASS | Six temporary enable actions were undone; browser shows eight Frozen nodes and approximately 0 credits / $0. Existing accepted trilogy, Character, and Environment remain unchanged. |
| BUG-1904 / VERIFY-1905 | PASS | Blank-cell and whole-label guards, positive-only Board 3 formulation, Storyboard v2 `2.16`, Continuation `1.11`, focused/full gates, and zero-cost preflight `grun_ffe145cdfe5d` completed before the paid trilogy. |
| PAID-1906 execution | COMPLETE, NOT ACCEPTED | `grun_eb3d5d6c9e09`; jobs `job_00b0174ffda0`, `job_fb692f0603fa`, `job_82d44f89f833`; assets `asset_be6d19cd17a5`, `asset_4c5d1589625a`, `asset_f0333fcf7843`; three 2048x1152 boards; 30 credits / $0.15; immediate balance 549.6 -> 519.6; no retry. |
| PAID-1906 visual gate | PARTIAL | All boards share the near-black/amber 3x2 sheet family and seven stacked rows per cell; photoreal physical-set quality and ship/hangar continuity improved. Board 2 values over-compress; Board 3 loses feline/dialogue/wardrobe intent and overloads titles; the retained Character reference still pulls exposed-waist/slight-CGI styling. |
| BUG-1907 root cause | FIXED | Uppercase `PANEL NN IMAGE:` was not recognized as storyboard content and therefore used generic 4,194-character slicing; `sheet` was also neutralized as a private alias. Recognition is now case-insensitive/structural and compaction is complete-clause, panel-aware, and dialogue-aware. No campaign story content was added to shared code. |
| Exact paid-output replay | PASS | The same Board 3 recipe output now selects `gpt_image_2_storyboard_compact` at 4,200 characters, keeps six instances of each of the seven labels, articulated feline forelegs, covered wardrobe, and the exact “Bolts” dialogue. |
| Final release verification | PASS | 759 backend tests; 758 web tests; lint; typecheck; production build; Studio browser smoke; clean schema 44 bootstrap; repo hygiene, storyboard genericity, file-size, style-drift, and diff-formatting guards. |
| Frozen browser/cache proof | PASS | All six storyboard GPT/Save nodes persist PAID-1906's exact artifact ids. `grun_5de1d1649627` completed 17/17 with all six nodes Frozen/Cached from `grun_eb3d5d6c9e09`, actual graph cost $0, and no new local media jobs. |
| Account-balance reconciliation | UNATTRIBUTED | The browser later displayed 499.6 credits, 20 below the immediate post-paid balance. The zero-cost proof has $0 run metrics and no corresponding local media job, so that delta is not attributable to this graph execution. |
| PAID-1909 execution | TERMINAL PARTIAL | `grun_4983b8fb3503`; Board 1 job `job_2df9c121411d` completed as 2048x1152 `asset_2e64119ce721`; Board 2 job `job_098d48bfaf98` failed after 5.1 seconds with `Internal Error, Please try again later.`; Board 3 dependency-skipped. Balance 499.6 -> 489.6: 10 credits / $0.05 only. |
| Board 1 cinematic/layout gate | PASS | Photoreal live-action physical-set treatment, realistic lens/material/lighting behavior, matching no-footer 3x2 chrome, correct top production strip, six populated image cells, and seven exact stacked labels per cell. |
| Board 1 Environment/story gate | PASS | The locked red-and-cream ship and ruined hangar dominate; the pilot begins distant among loading droids and advances causally through manifest, landing gear, connections, amber cue, and the still-closed service panel. |
| Board 1 identity/wardrobe gate | PASS | The retained pilot identity and cyborg construction remain coherent; the waist and abdomen appear covered throughout this output. |
| Board 1 metadata-value gate | FAIL | Row labels are complete and correctly ordered, but compact shaping moves clipped sentence tails into NOTES (`toward it.`, `secure`, `is visibly climbing.`) and leaves incomplete Panel 6 action/motion clauses. Raw recipe evidence contains the full clauses, isolating deterministic shaper loss. |
| Board 2 failure classification | PROVIDER TRANSIENT | Validation and submission succeeded with `gpt_image_2_storyboard_compact`, 13,598 -> 4,177 characters. The job failed on its first provider poll; this was not moderation/policy and consumed no additional credits. |
| Safe closure | PASS | Board 1 GPT/Save caches persist `grun_4983b8fb3503`; Boards 2-3 retain PAID-1906 caches; Environment remains frozen; saved browser estimate is approximately 0 credits / $0. |
| Automated trilogy audit | EXPECTED INCOMPLETE | `audit_storyboard_trilogy.py` stops with `run ... has no completed Board 2 image artifact`, correctly preventing a partial run from being labeled an accepted trilogy. |
| Next task | OPEN | BUG-1910 no-paid complete-clause metadata remediation, followed by VERIFY-1911. Any later PAID-1912 trilogy requires separate authorization. |

## Phase 20 prompt-boundary audit

Date: 2026-07-13

| Check | Result | Evidence |
|---|---|---|
| Raw recipe outputs | PASS | Board 1 raw: 8,676 chars and six SHOT/CAMERA/FRAMING/ACTION/MOTION/DIALOG sets; Board 2 raw: 13,598 chars and six complete sets; old Board 3 raw: 14,533 chars, six complete sets, feline/cat terms, and the exact Bolts line. |
| PAID-1909 provider prompts | MIXED | Board 1 (4,183 chars) and Board 2 (4,177 chars) each contain six non-empty CAMERA and FRAMING values. Both still show clipped row values and synthetic NOTES tails; Board 2 failed before image creation. |
| Old Board 3 submitted prompt | ROOT CAUSE CONFIRMED | `job_82d44f89f833` used a 4,194-character generic slice that ended before the panel plan and exact Bolts dialogue, allowing a humanoid droid interpretation. |
| Current-code Board 3 replay | PASS | The same old raw output now selects `gpt_image_2_storyboard_compact` at 4,200 chars, emits six panels, preserves feline/cat language, and keeps `Bolts, are you ready for this next adventure`. |
| Browser cache audit | PASS | Graph Studio shows Board 1 Save from `job_2df9c121411d`; Board 2 Save still points to older `job_fb692f0603fa`; Board 3 Save points to `job_82d44f89f833`; Environment is Frozen/Cached; balance is 489.6. |
| Original-image audit | CONFIRMED | Displayed Board 2 has blank CAMERA/MOTION in Panels 3-4. Displayed Board 3 shows a humanoid robot in the companion seat and no requested line. Both are historical images, not post-fix proofs. |
| Dialogue trace | PASS WITH BUDGET RISK | Sanitization keeps silent DIALOG blank and appends user-owned dialogue cues. Compact fitting reserves exact DIALOG first and reallocates budget to dialogue panels; it does not intentionally move speech, but it can over-compress other rows. |
| Compaction defect | OPEN | ACTION is clipped to 120 chars and its tail is synthesized into NOTES; minimum allocation order favors ACTION/NOTES before FRAMING/CAMERA/MOTION. This explains dangling notes and earlier empty/over-compressed camera metadata. |
| Focused tests | PASS | `./scripts/with_shared_python.sh -m pytest -q apps/api/tests/test_storyboard_prompt_regressions.py apps/api/tests/test_storyboard_trilogy_quality.py` -> 7 passed in 0.07s. |
| Side effects | NONE | Read-only DB/source/browser inspection only; no workflow mutation, graph run, provider request, media job, or credit spend. |
| Next task | OPEN | CONTRACT-2002, followed by BUILD-2003 and VERIFY-2004. PAID-2005 requires separate action-time authorization. |

## Phase 20 six-row trilogy sign-off and recovery hardening

Date: 2026-07-13

| Check | Result | Evidence |
|---|---|---|
| Shared recipe contract | PASS | Storyboard v2 `2.18`, Continuation `1.13`, and schema 46 use exact `SHOT / CAMERA / ACTION / MOTION / DIALOG / NOTES` rows; CAMERA owns framing and NOTES may have a blank value. |
| Prompt-boundary regressions | PASS | Complete row-local clauses, exact dialogue, legacy FRAMING merge, orphan-pronoun removal, and adjacent ACTION/MOTION fallback pass focused tests without campaign hardcoding. |
| Zero-credit browser proof | PASS | `grun_41a60964d9b6` completed 17/17 at $0; media jobs stayed 686; all three provider-bound prompts contained six copies of every required label, no FRAMING, and no dangling clause. |
| Paid execution | COMPLETE VIA RECOVERY | `grun_97a000ce7558`; jobs `job_f79af5a22caa`, `job_dd3fbdb6778c`, `job_03e334ff13e6`; assets `asset_d539ca196281`, `asset_b593a92980ab`, `asset_1fba3d65bc29`; all 2048x1152. Balance 489.6 -> 459.6: 30 credits / $0.15 exactly. |
| Provider-job safety | PASS | Board 2's already submitted task completed after a malformed status response. Recovery reused that exact job and submitted only the still-authorized Board 3 dependency; no Board 1/2 retry or duplicate provider request occurred. |
| Layout and metadata | PASS | All originals use the same footer-free dark/amber production strip, differentiated title/sequence, exact 3x2 geometry, and six horizontal label/value rows per cell. |
| Cinematic and Environment | PASS | Eighteen cells read as live-action feature-film stills; the same ship, ruined hangar, service-panel geography, ramp route, practical light, and departure axis remain recognizable. |
| Character and subject | PASS | The recurring pilot remains covered and coherent; Board 3 shows Bolts as a small unmistakably feline cyborg cat rather than a humanoid robot. |
| Story and handoffs | PASS | Distant loading approach -> inspection -> capacitor repair -> green closeout -> boarding -> harness -> lift -> daylight departure is causal. Both Board 1-to-2 and Board 2-to-3 pairs preserve state while advancing a distinct action/camera beat. |
| Dialogue | PASS WITH MINOR RENDERER SUFFIX | DROID/PILOT speakers and voice hints are visible; the full Bolts question survives. The image renderer adds a period after the closing quote, without changing the requested sentence. |
| Metadata-value residual | ACCEPTED MINOR | Board 1 Panel 5 visibly leaves ACTION blank while its image, SHOT, CAMERA, and MOTION still communicate the amber-cue beat. Current provider-bound shaping now fills a missing ACTION from adjacent user/recipe-owned MOTION content; no second paid proof was submitted. |
| Deterministic/visual manifest | PASS | `data/quality-manifests/grun_97a000ce7558.json` reports deterministic `pass`, visual `pass`, overall `pass`; D001-D004 and D010-D011 all pass. |
| BUG-2006 recovery regression | PASS | Poll-failed runs are recoverable and only `upstream_failed` skips rerun; muted skips remain terminal. Focused recovery/trilogy selection: 10 passed. |
| Queue/frozen closure | PASS | 689 media jobs total, zero active. All six Board GPT/Save nodes persist `grun_97a000ce7558`; Environment remains frozen; browser balance is 459.6 and saved estimate is 0 credits / $0. |
| Full release verification | PASS | Repo hygiene, storyboard genericity, file-size/style guards, backend, web, lint, typecheck, production build, Studio smoke, clean schema 46 bootstrap, migration status, and diff formatting pass. |

## Phase 21 fail-closed storyboard metadata preflight

Date: 2026-07-14

| Check | Result | Evidence |
|---|---|---|
| Final provider boundary | PASS | `validate_storyboard_metadata_preflight` runs after final shaping and before `ValidateRequest`/provider submission. The graph integration regression proves Panel 05 ACTION failure leaves the submission stub untouched. |
| Required values | PASS | Every panel requires exactly one non-empty SHOT/CAMERA/ACTION/MOTION/NOTES value; only DIALOG may be blank. Missing rows, duplicates, empty values, and None/N/A/Silence/no-dialogue/dash placeholders fail with panel/row-specific errors. |
| Story ownership | PASS | Empty NOTES may reuse only same-panel user/recipe-owned MOTION/ACTION/SHOT text. Storyboard genericity guard passes; no campaign name, subject, location, prop, dialogue, or action was added to shared code. |
| Recipe/schema contract | PASS | Storyboard v2 `2.19`, Continuation `1.14`, and migration 47 declare the non-empty metadata contract in prompt text and `output_contract_json`. Live persistent database reports schema 47 and both versions. |
| Focused verification | PASS | Recipe/shaping/trilogy/migration selection 32/32; preflight module 12/12; Python compile, genericity, and diff checks pass. |
| Full release verification | PASS | 777 backend tests; 758 web tests; lint; typecheck; production build; Studio browser smoke; clean schema 47 bootstrap/migration status; hygiene, genericity, file-size, style-drift, and formatting gates. |
| Live runtime | PASS | Web and API return HTTP 200; runner healthy; queue 0 queued/0 running; media jobs remain 689; no provider request or paid run occurred. |
| In-app Browser | PASS | After the user refreshed Graph Studio, Browser claimed the loaded Media Studio tab without navigating. Sadis Adventures showed 459.6 credits, approximately 0 credits / $0, exactly eight Frozen Environment/Storyboard GPT+Save nodes, two Muted prompt-only Environment nodes, one enabled Run button, and no console warnings/errors. Both local workflow tabs carried unsaved-change badges; no edit, save, Run click, graph execution, or provider request occurred. The working tab was kept open and the duplicate unreachable tab was removed. |

## Phase 22 BUG-2205 semantic metadata and closed-state remediation

Date: 2026-07-14

| Check | Result | Evidence |
|---|---|---|
| Semantic provider guard | PASS | ACTION, MOTION, and NOTES now reject generic dangling copulas, incomplete predicate starters, short imperative fragments, noun-only truncations, and dash tails while allowing compact complete clauses and uppercase state/title notes. Empty required rows remain a separate fail-closed error; blank DIALOG remains allowed. |
| Generic repair ownership | PASS | Tight-budget repair reuses only ACTION/MOTION/NOTES/SHOT values from the same panel. Exact DIALOG is not rewritten, and no character, location, vehicle, prop, dialogue, or campaign beat literal was added to shared code. |
| Budget termination | PASS | Redistribution uses remaining source-length budget headroom rather than rendered-length delta. The formerly CPU-bound `test_gpt_image_2_graph_prompt_shaper_avoids_dangling_metadata_clauses` now completes immediately instead of expanding a normalized saturated capsule indefinitely. |
| Exact frozen replay | PASS | Board 1: 4,198 -> 4,119, `gpt_image_2_storyboard_metadata_normalized`; Board 2: 14,135 -> 4,181, `gpt_image_2_storyboard_compact`; Board 3: 4,156 -> 4,120, `gpt_image_2_storyboard_metadata_normalized`. All validate six complete metadata sets with zero semantic fragments; Board 2's two attributed lines and Board 3's Bolts line each remain present exactly once. |
| Board 1 user input | PASS | Graph Studio saved a positive user-owned lock requiring every service/access compartment to remain visibly closed and flush through Panels 01-06, with no interior components visible, and assigning the first service-panel opening to Board 2 Panel 01. Persisted workflow remains 17 nodes / 28 edges. |
| Focused verification | PASS | Dangling-clause plus metadata/prompt target 28/28; trilogy/metadata/prompt selection 33/33; storyboard genericity guard and `git diff --check` pass. |
| Full backend | PASS | 789 tests passed in 263.85 seconds. |
| Live runtime | PASS | Detached `media-studio` screen remains present; web redirects into the app and API `/health` returns HTTP 200. Database reports 692 media jobs, 740 graph runs, and zero queued/running media jobs. |
| Frozen Browser closure | PASS | Saved Sadis Adventures has no unsaved badge; Browser shows 429.6 credits, Graph approximately 0 credits / $0, Run available but untouched, and all eight Environment/Storyboard GPT+Save nodes Frozen. Environment GPT/Save remain Cached. Console warnings/errors: zero. Graph Studio was kept open. |
| Paid/provider side effects | NONE | No Run click, graph execution, provider request, media generation, or credit spend occurred. The prior Phase 22 paid artifacts remain frozen and unchanged, so this closes deterministic remediation but does not claim a new visual proof. |

## Phase 23 post-BUG-2205 paid acceptance verification

Date: 2026-07-14

| Check | Result | Evidence |
|---|---|---|
| Browser preflight | PASS | Sadis Adventures was clean with Environment frozen/cached. Only the six Storyboard GPT/Save nodes were enabled. Browser estimate was exactly 30 credits / $0.15 and starting balance was 429.6. |
| Paid execution | TERMINAL PARTIAL | `grun_4adbeed15f4d`; Board 1 `job_d3bb5b05a5f3` / `asset_c97abb7d31e7`; Board 2 `job_f4545c9c3535` / `asset_de8b86098d98`; both 2048x1152. Board 3 `job_8f06af34e56e` failed with provider `Internal Error, Please try again later.` and its Save node dependency-skipped. No retry was submitted. |
| Accounting | PASS | Browser balance 429.6 -> 409.6: 20 credits / $0.10 for two successful boards. The failed Board 3 provider task did not consume the remaining 10-credit estimate. Exactly three new media-job records exist, one per attempted board, with no duplicate submission. |
| Board 1 visual | PASS WITH WARDROBE RESIDUAL | Matching footer-free 3x2/six-row design, correct Board 1 strip, complete ship/hangar establishing geography, droid loading, causal exterior inspection, amber cue, and visibly closed service panel in Panel 06. The retained Character sheet still pulls exposed-waist styling. |
| Board 2 visual | PARTIAL | Exact matching layout/strip family, same pilot/ship/hangar, distinct closed-panel-to-latch-opening handoff, service droid, attributed dialogue, and causal capacitor replacement/green closeout. Dialogue retains the known extra period after the closing quote. |
| Metadata values | FAIL | Board 2 visibly renders incomplete values including `The same panel now.`, `within the pilot's.`, and `The replacement becomes.` Current `storyboard_metadata_semantic_fragments` returns `[]` and `validate_storyboard_metadata_rows` passes, proving a generic semantic-guard coverage gap rather than a renderer-only typo. |
| Trilogy visual gate | INCOMPLETE | Board 3 has no completed artifact, so Bolts, the Board 2-to-3 handoff, cockpit/lift sequence, final dialogue, and full 18-frame continuity cannot be evaluated. `audit_storyboard_trilogy.py --run-id grun_4adbeed15f4d` correctly exits nonzero with no completed Board 3 image artifact. |
| Runtime closure | PASS | Run is terminal failed with zero active media jobs. Database reports 695 media jobs and 741 graph runs. All six Storyboard GPT/Save nodes were restored to Frozen; Environment remains Frozen/Cached; Browser shows approximately 0 credits / $0, Run available, Sadis Adventures clean, and 409.6 credits. Graph Studio was kept open. |
| Signoff | WITHHELD | This is useful partial evidence but not a complete accepted trilogy. Next task is no-paid BUG-2303; any later provider retry requires fresh authorization. |

## Phase 24 shared recipe parity and final trilogy acceptance

Date: 2026-07-14

| Check | Result | Evidence |
|---|---|---|
| Shared recipe contract | PASS | Storyboard v2 `2.20` and Continuation `1.15` call one shared immutable footer-free 16:9 / 3x2 / six-row sheet contract, publish identical output contracts and generation defaults, and differ only in user inputs plus continuation-only prior-board/handoff roles. Schema migration 48 synchronized the live database. |
| Story ownership / hardcoding | PASS | Shared recipe/compiler code contains no campaign character, location, vehicle, companion, dialogue, or beat literals. `scripts/check_storyboard_recipe_genericity.py` passes. Character identity, Environment, wardrobe, subject design, dialogue, titles, production metadata, and story beats remain workflow/recipe inputs. |
| Zero-credit browser proof | PASS | Initial `grun_843556634ffb` and final post-BUG-2406 `grun_1b3b3ad70980` each completed 17/17 with all provider/save nodes Frozen/Cached, zero new media jobs, zero graph cost, reused Character `asset_901adc9b21d1`, and reused Environment. Final Browser state: 379.6 credits, approximately 0 credits / $0, Run available, and no warnings/errors. |
| Paid execution | PASS | One Run click produced terminal `grun_466f601a6e3d`: Board 1 `job_b7219cfa11d9` / `asset_793d26013f2c`; Board 2 `job_e7bcd7598cbb` / `asset_a978b1d79bbc`; Board 3 `job_272ad17669c6` / `asset_b7750eef86da`. All are 2048x1152; 17/17 graph nodes completed; queue returned to zero. |
| Accounting | PASS | Browser balance 409.6 -> 379.6, exactly 30 credits / $0.15. Media jobs 695 -> 698, exactly one per board, with no retry or duplicate provider submission. |
| Layout and board identity | PASS | All three originals use the same footer-free dark/amber top strip, exact 3x2 geometry, identical image/metadata proportions, and stacked SHOT/CAMERA/ACTION/MOTION/DIALOG/NOTES rows. Titles and SEQUENCE values visibly distinguish Boards 1, 2, and 3. |
| Character / Environment / cinematic quality | PASS | The recurring covered pilot, cyborg construction, weathered red-and-cream ship, ruined hangar, ramp/droid route, practical lighting, and north-door axis remain coherent. All eighteen cells read as high-quality live-action feature-film stills. |
| Story / dialogue / Bolts | PASS | The sequence advances through approach/loading, inspection, capacitor repair, green closeout, boarding, cockpit securing, lift, and daylight departure. Board 2 dialogue is attributed with voice hints; Board 3 preserves the complete requested line; Bolts is unmistakably a feline cyborg cat. |
| Visual handoff V007 | FAIL | Board 2 Panel 6 -> Board 3 Panel 1 is adjacent and distinct. Board 1 Panel 6 instead drifts to a wider ramp/loading view and does not preserve Panel 5's closed amber service-panel composition for Board 2 Panel 1. The raw recipe contained the correct state; pre-final-fix compaction reduced it to `The pilot stands` plus background loading. |
| Post-run BUG-2406 | PASS NO-PAID | Generic compaction now preserves spatial `before` objects, complete clauses ending in object pronouns, and the primary clause before concurrent `while`; rejects incomplete subclauses/participles/predicate and preposition tails; and reserves the minimum complete ACTION/MOTION/NOTES budgets. Fresh final Browser raw-output replay produces 4,129 / 4,198 / 4,194-character prompts, six panels each, zero semantic fragments, and a Board 1 Panel 6 action that retains the closed amber panel and latch hand. |
| Automated verification | PASS | Focused semantic regression target 47/47; affected Graph/recipe/schema/prompt/preflight/trilogy suite 245/245 in 78.13s; genericity and `git diff --check` pass. Earlier full backend evidence was 788/797 before header-contract restoration, followed by a complete affected-suite pass; no false claim of a final all-backend run is made. |
| Browser closure | PASS | Sadis Adventures has no unsaved badge; balance is 379.6; estimate is approximately 0 credits / $0; all six Storyboard GPT/Save nodes and Environment GPT/Save are Frozen; Character remained unchanged; Media Studio is healthy in detached screen `85408.media-studio`; Graph Studio was kept open. |
| Manifest / signoff | WITHHELD | `data/quality-manifests/grun_466f601a6e3d.json`: deterministic `pass`, visual `needs_review`, overall `not_accepted`, with V007 the only failed visual gate. PAID-2407 would be the final post-fix proof and requires new authorization. |

## Phase 24 PAID-2407 post-BUG-2406 provider proof

Date: 2026-07-15

| Check | Result | Evidence |
|---|---|---|
| Browser preflight | PASS | Media Studio API, web, runner, and queue were healthy. Sadis Adventures was clean; Character and Environment were unchanged/frozen. Exactly the six Storyboard GPT/Save nodes were enabled. Browser estimate was 30 credits / $0.15 and balance was 379.6. Database backup `media-studio-backup-20260715T070610Z.db` passed `quick_check`; SHA-256 `0defc8e926bffa095a5c3f3cb2e73fef750b4c5c6efd6689a4e10011aeaa09bc`. |
| Paid execution | PASS | Exactly one Run click created `grun_531ac2847b59`. All 17 graph nodes completed/cached. Board jobs/assets: `job_9f8bb2ae10e2` / `asset_20aedc4047e0`, `job_31c2f708da22` / `asset_25422c631328`, `job_7ccd6963d697` / `asset_ab16097ba169`; all 2048x1152. No retry or duplicate provider job occurred. |
| Accounting | PASS | Browser balance 379.6 -> 349.6, exactly 30 credits / $0.15. Exactly three intended paid jobs completed; queue returned to zero. |
| Shared layout / numbering | PASS | All three boards use the same footer-free dark/amber top strip, exact 3x2 grid, identical panel/metadata geometry, and SHOT/CAMERA/ACTION/MOTION/DIALOG/NOTES row order. Titles and SEQUENCE values visibly distinguish Boards 1, 2, and 3. |
| Cinematic / Environment / story | PASS | All eighteen cells use coherent live-action feature-film still treatment. The same weathered ship, ruined hangar, service-panel side, droid route, cockpit material language, and north-door axis persist through approach, repair, boarding, lift, and departure. |
| Cross-board handoffs | PASS | Board 1 Panel 6 now preserves the closed amber panel and hand beside the latch; Board 2 Panel 1 advances to the latch turn. Board 2 Panel 6 preserves the closed green panel; Board 3 Panel 1 advances away toward the ramp. Both pairs are adjacent but distinct. |
| Dialogue / Bolts | PASS | DROID and PILOT lines remain visibly attributed with voice hints. Board 3 preserves `Bolts, are you ready for this next adventure?` and Bolts is unmistakably feline rather than humanoid. |
| Provider-bound metadata | FAIL | Submitted prompts contain incomplete values: Board 1 Panel 5 NOTES `The pilot follows the status-light sequence until.`; Board 2 Panel 1 ACTION `The pilot's mechanical hand grips;`; Board 2 Panel 5 ACTION `The pilot locks the retaining clips around;`; Board 3 Panel 2 MOTION `Boots contact successive.`; Board 3 Panel 5 MOTION `The cracked floor, painted markings.` Most Board 2-3 CAMERA values collapse to `Live-action cinema camera.` rather than carrying angle/movement/lens detail. The graph still recorded `storyboard_metadata_preflight: passed`, proving a guard coverage gap. |
| Character / wardrobe | FAIL KNOWN REFERENCE LIMIT | Pilot identity and cyborg construction are consistent, but the retained user-selected Character sheet continues to pull exposed-waist styling despite sealed opaque-coverall prompt text. The sheet was not replaced or edited. |
| Manifest / signoff | WITHHELD | `data/quality-manifests/grun_531ac2847b59.json`: deterministic `pass`, visual `needs_review`, overall `not_accepted`; V001 and V005 fail. The deterministic evaluator's current D001 only proves presence/shape, not semantic completeness, which is BUG-2408. |
| Frozen Browser closure | PASS | All six Storyboard GPT/Save and Environment GPT/Save nodes are Frozen; graph estimate is approximately 0 credits / $0; balance is 349.6. The unrelated Time Stop workflow remains open with its pre-existing unsaved changes untouched. |

## Phase 24 BUG-2408 / VERIFY-2409 metadata and CAMERA guard

Date: 2026-07-15

| Check | Result | Evidence |
|---|---|---|
| Red characterization | PASS | Nine expected failures reproduced the five exact PAID-2407 metadata fragments, three weak CAMERA values, and the compact-capsule path before implementation. |
| Shared semantic owner | PASS | `storyboard_metadata_preflight.py` owns the campaign-agnostic semantic/CAMERA contract. It rejects terminal transitive predicates, incomplete preposition/adjective/determiner tails, successive-object truncation, and noun-list fragments, and requires angle, movement, and lens direction in CAMERA. `prompt_shaping.py` repairs only from existing user/recipe-owned panel content or neutral camera semantics. |
| Tight-budget preservation | PASS | CAMERA receives a protected semantic budget; compaction retains all three camera components and returns reclaimed header space to ACTION/MOTION/NOTES allocation. Exact dialogue remains unchanged, and no campaign noun or beat was introduced into shared code. |
| Exact current-code replay | PASS | New zero-credit raw artifacts shape Board 1 11,573 -> 4,110, Board 2 12,947 -> 4,179, and Board 3 15,208 -> 4,187 characters. All three pass six-panel row validation; `semantic_fragments` is `[]` and `camera_gaps` is `[]` for every board. |
| Handoff/story preservation | PASS | Replay preserves Board 1's closed amber-panel/latch-hand ending, Board 2's latch-opening start and closed-green ending, Board 3's move toward the ramp, and all user-owned dialogue. |
| Automated verification | PASS | Focused 60/60; affected Graph/recipe/schema/prompt/preflight/trilogy 258/258; full backend 823/823. Storyboard genericity, `compileall`, single-owner duplication check, and `git diff --check` pass. |
| Zero-credit Browser proof | PASS | In-app Browser run `grun_814d284c8c6f` completed 17/17 in 232.0 seconds. All six Storyboard GPT/Save and Environment GPT/Save nodes were Frozen/Cached, balance stayed 349.6 credits, media jobs stayed 701, graph estimate stayed approximately 0 credits / $0, and queue returned to 0/0. Graph Studio was left open. |
| Runtime health | PASS | API reports healthy embedded runner, queue 0 queued / 0 running, current pricing metadata, and no runtime issues after the proof. |
| Deterministic manifest | PASS | `data/quality-manifests/grun_814d284c8c6f-current-code.json` reports deterministic `pass` and 0.0 credits used. Visual remains `needs_review` because the manifest reuses PAID-2407 images and no new provider output was authorized. |
| Scope preservation | PASS | Character sheet, Environment, graph topology, reference order, recipe fields, provider/model/pricing settings, and the unrelated Time Stop unsaved workflow were unchanged. No media provider request, new job, asset, or credit spend occurred. |
| Final disposition | NO-PAID COMPLETE | BUG-2408 and VERIFY-2409 are closed. A separately authorized paid trilogy is the only remaining way to prove the repaired prompts visually. The exposed-waist tendency remains a known limitation of the retained user-selected Character reference. |

## Phase 24 PAID-2410 post-BUG-2408 rendered proof

Date: 2026-07-15

| Check | Result | Evidence |
|---|---|---|
| Server and Browser preflight | PASS | Media Studio started in detached screen `90231.media-studio`; readiness, API, runner, web route, and queue passed. Database backup `media-studio-backup-20260715T122809Z.db` completed. Browser showed 349.6 credits, exactly six Storyboard GPT/Save nodes enabled, Environment GPT/Save Frozen/Cached, and an authoritative graph estimate of 30 credits / $0.15. |
| Paid execution | PASS | One Run click created `grun_dcdcf40aa2b2`. Board 1 `job_0393797ea128` / `asset_7305c2b60a93`, Board 2 `job_9318479a152c` / `asset_79a34fbb80fe`, and Board 3 `job_b1be5f7e57f5` / `asset_338f93c9c12b` completed in dependency order; all are 2048x1152. No retry or duplicate job occurred. |
| Accounting | PASS | Balance 349.6 -> 319.6, exactly 30 credits / $0.15. Media jobs 701 -> 704, exactly one new job per board. Queue returned to 0/0. |
| Cinematic / Environment / character | PASS | All eighteen cells read as polished live-action feature-film stills. The recurring covered pilot, weathered ship, ruined hangar, ramp/service-panel geography, droid lane, cockpit material language, lighting, and north-door axis remain coherent. |
| Story / handoffs / dialogue | PASS | The story advances through loading, inspection, amber fault, capacitor repair, green closeout, boarding, securing, lift, and departure. Board 1 Panel 6 -> Board 2 Panel 1 and Board 2 Panel 6 -> Board 3 Panel 1 are adjacent and distinct. Requested droid, pilot, and Bolts dialogue is visibly attributed and complete. |
| Complete sheet layout V001 | FAIL | Boards 1-2 share the expected sheet geometry. Board 3 adds an extra pre-image title strip above every panel, duplicating SHOT titles and changing image/metadata proportions. Board 2 Panel 2 SHOT is `02 —.`; Board 3 includes `Preserve Board 2’s exact repaired.`, `Clearly show Bolts’.`, `The cracked hangar floor.`, and `Final-board payoff: preserve the exact.` |
| Subject design V008 | FAIL | Bolts is feline and cat-sized but appears as an ordinary tabby without the requested two worn-red mechanical forelegs or cyan status lights. Board 3 Panel 4 omits Bolts from the BOTH SECURED beat. The compact provider prompt retained `cyborg cat` but dropped those distinctive user-owned traits. |
| Guard/auditor diagnosis | FAIL GAP | All three jobs recorded preflight `allow`; `storyboard_metadata_semantic_fragments` and CAMERA-gap checks return empty; D001 passes. The guard does not validate meaningful SHOT suffixes and misses curly possessives, terminal adjective/participial phrases, and short noun-only motions. D002 does not prove that distinctive user subject traits survived compaction or that the rendered board avoided duplicate panel-title strips. |
| Manifest / signoff | WITHHELD | `data/quality-manifests/grun_dcdcf40aa2b2.json`: deterministic `pass`, visual `needs_review`, overall `not_accepted`; V001 and V008 fail. BUG-2412 is the next no-paid remediation. |
| Frozen saved closure | PASS | All six Storyboard GPT/Save plus Environment GPT/Save nodes were returned to Frozen; estimate is approximately 0 credits / $0; balance is 319.6; the refrozen workflow was saved. PAID-2410 outputs remain preserved in run history as evidence, while the saved Storyboard cache retains prior accepted run `grun_97a000ce7558` because the new trilogy failed strict V001/V008. No retry is authorized. |

## Phase 25 deterministic storyboard compiler and sheet compositor

Date: 2026-07-15

| Check | Result | Evidence |
|---|---|---|
| BUG-2412 exact replay | PASS | PAID-2410 Board 1-3 raw artifacts shape to 4,168 / 4,189 / 4,193 characters. All eighteen panels pass meaningful SHOT, semantic-fragment, CAMERA, and required-row validation. Board 3 retains `mechanical forelegs` and `cyan status lights`; every prompt retains the single-title-region lock. |
| Typed contract | PASS | Storyboard v2 and Continuation both normalize to immutable `StoryboardSheetSpec` v1 with fixed `storyboard_v2_3x2_rows` layout, six ordered panels, exact production metadata, dialogue, and visual continuity fields. Mapping rejects foreign contract/layout versions, blank titles, missing metadata, and malformed panels. |
| Compiler node | PASS | `storyboard.compile` accepts only Prompt Recipe `result` JSON and emits an art-only prompt, typed spec, and six optional panel prompts. Art prompts exclude sheet chrome and current project/title text while retaining user-owned subject/wardrobe/reference authority. |
| Compositor node | PASS | `image.storyboard_sheet` accepts one equal 3x2 grid or exactly six ordered images, caps inputs at 4096px, emits one data-root 2048x1152 PNG and layout metadata, records parent lineage, wraps text, and fails rather than clipping. One-grid and six-image modes are byte-identical for equivalent inputs. |
| Unicode visual regression | PASS | Offline trilogy proof initially exposed missing-glyph boxes for em dashes under Pillow's bitmap font. CR-2502 replaced it with a validated Unicode TrueType candidate chain. Regenerated titles and DATE/ARTIST rows reproduce em dashes correctly across all three exact specs. |
| Offline three-board visual proof | PASS | `tmp/phase25-proof/board-1.png` through `board-3.png` and `trilogy-contact.png` render the three latest recipe results with identical title placement, five-field top strip, 3x2 image geometry, row heights, borders, palette, and horizontal SHOT/CAMERA/ACTION/MOTION/DIALOG/NOTES order. Only user-owned content differs. |
| Code review | PASS | Review artifacts: `docs/reviews/20260715_184500/20260715_211307/`. CR-2501 (layout/title mapping bypass) and CR-2502 (Unicode missing glyphs) are fixed. No unresolved correctness, architecture, duplication, security, API, scalability, or rollback blocker remains. |
| Automated verification | PASS | 91 focused/regression tests and full backend 844/844 pass. Earlier phase-wide 758 web tests, web typecheck, lint, file-size/hygiene, catalog refresh, compile, duplication ownership, genericity guard, and `git diff --check` pass; no web code changed in the final renderer fix. |
| Restorable backup | PASS | `data/backups/media-studio-before-phase25-graphwf_4fd06f50c493-20260715T2120.db` reports `integrity_check=ok`; SHA-256 `1d597e52916607da18238039133431c225e2a9db4df2aebc6bd255d1743c7ec6`. |
| Target-only migration | PASS | Only `graphwf_4fd06f50c493` changed: 17 -> 23 nodes and 28 -> 37 edges. Three recipe `result` outputs now feed three compiler nodes; compiler art prompts feed the existing GPT nodes; typed specs and GPT art feed three compositor nodes; compositor images feed existing Frozen Save nodes. Exact reference-edge diff against backup is empty. |
| Frozen/accounting safety | PASS | All four GPT Image and four Save nodes retain Frozen mode and historical cached run/artifact IDs. Graph validation is 0 errors / 0 warnings; estimate is 0 credits / $0. API balance is 319.62, runner healthy, queue 0 queued / 0 running, and no provider job, graph run, asset, or credit spend occurred. |
| In-app Browser | PASS | Saved Graph Studio reload shows each of the six new nodes exactly once, `Compile Storyboard` and `Storyboard Sheet` in the node palette, clean Sadis tab, historical previews retained, ≈0 / $0, Run enabled but not clicked, and zero console warnings/errors. The unrelated Time Stop unsaved tab remains untouched. |
| Final disposition | DETERMINISTIC SIGNOFF | Phase 25 implementation is complete. Layout and metadata consistency are now deterministic rather than probabilistic. Generative variation remains only in art cells. One new real-art trilogy is optional and requires separate paid authorization. |

## Phase 26 distinct metadata roles and paid compositor proof

Date: 2026-07-16

| Check | Result | Evidence |
|---|---|---|
| Missing/duplicate metadata guard | PASS | Compiler, mapping, compact shaping, and provider preflight reject missing or exact/near-duplicate ACTION/MOTION/NOTES values. Cross-field/SHOT narrative fallbacks are removed. Storyboard v2 `2.23`, Continuation `1.18`, and schema 51 expose identical user-owned Panel Notes Cues. |
| Zero-credit preflight | PASS | `grun_bf40ac212a42` completed with six valid panels per board and complete distinct metadata. Current-code CAMERA replay recognizes compound movement forms. Backup `media-studio-backup-20260716T063000Z.db` reports integrity ok with SHA-256 `544af9e7deedf451a88dc169b2b26a0589235935bf098580f4d8e47a9a4c97d2`. |
| Paid execution | PASS | Exactly one authorized trilogy ran as `grun_26f886636aea`. Board art assets: `asset_e4e3c74424b1`, `asset_f809f9d705ef`, `asset_b148e11a5b73`. Saved sheet assets: `asset_graph_53cca9af05cad858f80a4047`, `asset_graph_22ab6d2eeb3399c510fe6219`, `asset_graph_8d13bd05371d4b49cef8a6ff`. All are 2048x1152; no retry occurred. |
| Accounting | PASS | Balance 319.62 -> 289.62, exactly 30 credits / $0.15. The workflow was refrozen and estimates 0 credits / $0. BUG-2610 now hydrates the historical run from its provider jobs and Run History displays `30 cr`, avoiding the unsupported `$0.00` claim. |
| Exact layout and metadata | PASS | All boards use `storyboard_sheet_spec` v1 / `storyboard_v2_3x2_rows` v1 with identical 2048x1152 geometry, title position, five-field strip, 3x2 panels, and six row heights. All 18 ACTION/MOTION/NOTES sets are complete, distinct, and exact. A suspected Board 2 header crop was disproved by identical-hash rerender plus focused crop inspection. |
| Cinematic/character/environment/story | PASS WITH EXCEPTIONS | Premium live-action treatment, covered recurring pilot, ship/hangar family, repair causal flow, exact dialogue, Board 1->2 closed-amber/latch advance, and Board 2->3 green-panel/ramp advance pass. Board 1 Panel 1 lacks the requested full-ship-length establishing scale; Panel 4 suggests an open recess. |
| Bolts and final launch beat | FAIL STRICT | Bolts is feline-faced but too humanoid rather than a compact natural quadruped cyborg cat. Board 3 Panel 5 renders an exterior lift instead of the requested cockpit two-shot with both occupants/dialogue. Board 3 Panel 6 departure passes. |
| Post-paid compiler audit | FIXED, NO-PAID | The art-only compiler could truncate MOTION at a word boundary and concatenate NOTES. `_bounded_art_clause` now emits complete generic clauses. Exact paid-spec replay is 3,702 / 3,622 / 4,026 characters, six cells each, with no joined-clause patterns. A second visual proof is not authorized. |
| Automated verification | PASS | Focused compiler/spec/graph/trilogy tests pass 39/39. Full release gate passes 863 backend and 758 web tests, lint, typecheck, production build, file-size/style/hygiene, schema 51, recipe/compiler genericity, and `git diff --check`. |
| Browser closure | PASS | In-app Browser shows completed and failed paid history as provider-observed credits (`6 cr`, `10 cr`, `20 cr`, and `30 cr`) with no `$0.00` rows. Direct API replay reports `actual_credits=30.0` for `grun_26f886636aea`; the graph remains Frozen/Cached at ≈0 / $0. |
| Final disposition | PHASE COMPLETE; ART SIGNOFF WITHHELD | The repeated metadata and deterministic multi-board sheet goals are signed off, and BUG-2610's accounting presentation defect is closed. The current generative art trilogy is evidence, not final visual acceptance; optional PAID-2611 requires fresh authorization. |

## Phase 27 legacy-layout fidelity and 4:3 source-grid reflow

Date: 2026-07-16

| Check | Result | Evidence |
|---|---|---|
| Red characterization | PASS | Phase 26 geometry assigned 44.2% of each panel to metadata and discarded 49.9% of each equal-grid source cell vertically. Regressions now require art at least two-thirds of panel height, metadata no more than one-third, an approximately 1.9:1 art window, source-grid order, and action-first prompt direction. |
| Architecture correction | PASS | `StoryboardSheetSpec` layout v2 requests one text-free 4:3 source plate with a row-major 2-column by 3-row grid. `image.storyboard_sheet` extracts six approximately 2:1 cells and reflows them into the approved footer-free 3-column by 2-row 2048x1152 sheet. Render metadata reports `wide_2x3_source_grid` and the 58% vertical art safe band. |
| Exact prompt replay | PASS | Zero-credit run `grun_8266439febee` emits 3,355 / 3,605 / 4,038-character Board 1-3 art prompts. All three retain the 4:3 / 2x3 source contract and remain under the 4,200-character provider budget. Shared code and recipe text remain campaign-agnostic. |
| Automated verification | PASS | Final source-grid code passes 105 focused storyboard tests and the complete backend suite at 865/865. Storyboard recipe/compiler genericity, targeted compilation, and `git diff --check` also pass. No web code changed in this slice. |
| Backup / scope | PASS | Backup `data/backups/media-studio-backup-20260716T103636Z.db` reports integrity ok; SHA-256 `e8bfe6399fe6c9546ba4ee5cda2e851cebfe9dc46946dae555a71aaa96fc15e1`. Only `graphwf_4fd06f50c493` was intentionally updated; Character, Environment, story inputs, 23-node/37-edge topology, reference order, provider/model/pricing settings, and unrelated workflow data were preserved. |
| Paid attempt | TERMINAL PARTIAL | One authorized attempt created `grun_b8c24c36819a`. Board 1 completed as `job_7785b31f04cc` / `asset_fffdf76a897c`. Board 2 `job_13d20df7d542` was canceled and refunded after the provider's 2x3 behavior exposed the source-contract mismatch; Board 3 was never submitted. Final balance is 279.6, exactly 10 credits / $0.05 below the 289.6 preflight balance. No retry occurred. |
| Corrected Board 1 proof | PASS | The accepted paid source was reflowed by current code in zero-credit run `grun_8266439febee` and saved as `asset_graph_c75aa12f04307fd5b67c25bf` / `reference-media/images/cab275024c5505c534411f7f5a57b13fbb5a8f2e2340f156b931d9b1a97e3fa8.png`. Original-resolution review passes the prior dark/amber sheet language, image-dominant wide cells, compact exact rows, ship/hangar Environment, recurring pilot, causal action, and the closed amber-panel ending. |
| Frozen closure | PASS | Board 1 GPT is Frozen on `grun_b8c24c36819a`; Board 1 Save is Frozen on `grun_8266439febee`; Boards 2-3 GPT/Save and Environment remain Frozen. The workflow therefore returns to an approximately zero-cost state with no implicit paid continuation. |
| Final disposition | FULL SIGNOFF WITHHELD | The deterministic design regression is fixed and Board 1 is accepted. Boards 2-3 still require one separately authorized 20-credit / $0.10 proof and full-trilogy inspection under PAID-2706 / VERIFY-2707. |

## Phase 28 reference-layout fidelity and cache compatibility

Date: 2026-07-16

| Check | Result | Evidence |
|---|---|---|
| Historical comparison | PASS | In-app Browser inspection of `asset_338f93c9c12b` and its exact submitted prompt established the approved compact dark/amber hierarchy. SQLite provenance confirmed the visible regression mixed current Board 1 art-only input with historical complete-sheet Board 2-3 inputs. |
| Deterministic layout v3 | PASS | The 2048x1152 compositor uses one compact title/production band, one SHOT heading per panel, image-dominant 3x2 cells, and exactly CAMERA/ACTION/MOTION/DIALOG/NOTES below each image. SHOT is no longer repeated as metadata and the page remains footer-free. |
| Compatible-source guard | PASS | Current prompt provenance, an explicit `storyboard_art_grid_v1` plus `2x3` lineage pair, six ordered images, and operator-owned manual grids pass. Historical complete-sheet and incomplete audited declarations fail closed before image slicing. No campaign term or asset ID appears in shared compatibility code. |
| Original-resolution proof | PASS | `tmp/phase28-proof/board-1-layout-v3.png`, `board-2-layout-v3-fresh.png`, `board-3-layout-v3.png`, and `trilogy-layout-v3-contact.png` demonstrate identical chrome with larger action images and five compact rows. Consecutive Board 2 renders are byte-identical (`ed0bf19f...`) with no pixel diff. |
| Prompt replay | PASS | Exact saved recipe results compile to 3,411 / 3,661 / 4,094-character Board 1-3 art prompts. All include the current contract, remain below 4,200 characters, contain six ordered cells, and pass compatibility. The storyboard genericity guard passes. |
| Automated verification | PASS | 111 focused storyboard tests and all 871 backend tests pass. Compilation, node-catalog refresh, and `git diff --check` pass. |
| Backup and bounded lineage annotation | PASS | Backup `data/backups/media-studio-before-phase28-source-audit-20260716T140333Z.db` reports integrity `ok`, SHA-256 `22547da236a4a714e18588c78a5807fff0583a5d167d5ac1224db59f416042b6`. Database comparison confirms exactly one changed asset payload: `asset_fffdf76a897c`, annotated with generic audited contract/grid lineage only. |
| In-app Browser zero-credit proof | PASS | `grun_be172e6a307c` renders Board 1 layout v3 at 2048x1152, rejects the historical Board 2 complete sheet with the expected compatibility error, and skips Board 3 upstream. Actual cost is $0, zero media jobs were created, balance remains 279.6, graph estimate remains approximately 0 credits / $0, and queue is 0/0 healthy. |
| Scope preservation | PASS | Historical assets/prompts, selected Character, Environment, story fields, reference order, 23-node/37-edge topology, provider/model/pricing settings, Frozen GPT/Save nodes, and unrelated Time Stop changes are unchanged. |
| Final disposition | DETERMINISTIC SIGNOFF | The layout/metadata regression and mixed-cache defect are fixed. A clean post-fix live trilogy is optional under separately authorized PAID-2807 and must pass VERIFY-2808 before final visual signoff. |

## Phase 29 historical-design fidelity and concise typed metadata

Date: 2026-07-17

| Check | Result | Evidence |
|---|---|---|
| Historical comparison | PASS | Original-resolution review of `asset_338f93c9c12b` against layout v3 identified the missing thin outer frame, unified inline production band, title/SHOT hierarchy, near-black rows, and readable condensed metadata proportions. Historical media remained read-only. |
| Shared recipe contract | PASS | Storyboard v2 `2.24` and Continuation `1.19` share one output/display contract and identical budgets. SHOT is typed once and rendered only above the image; visible rows are CAMERA/ACTION/MOTION/DIALOG/NOTES. Story content remains recipe-input-driven. |
| Typed metadata boundary | PASS | `StoryboardSheetSpec` bounds generated SHOT/CAMERA/ACTION/MOTION at complete generic clause boundaries across multiline, compact-plan, and inline serialized forms. Structured user PANEL NN notes remain exact authority; DIALOG/NOTES never receive silent truncation. False-positive semantic rules are length/predicate bounded. |
| Layout v4 | PASS | Deterministic 2048x1152 compositor reports `layout_version=4`, thin amber outer frame, unified inline header, 30px board title, 20px SHOT headings, 352px image height, five 30px rows, 15px minimum value text, and no footer or duplicate SHOT row. |
| Original-resolution proof | PASS | `tmp/phase29-proof/board-1-layout-v4-final.png` uses the accepted Board 1 art source and final typed spec. Visual review confirms the historical production-board language, complete concise SHOT headings, image-dominant action frames, and compact readable rows. |
| Browser zero-credit proof | PASS WITH EXPECTED CACHE STOP | `grun_0c441e491fd6` advances all recipes/compilers and composes Board 1 at 2048x1152. Board 2 correctly rejects its frozen historical complete-sheet cache because it is not a current art-only 2x3 source. Board 3 skips downstream. Estimate stays approximately 0 credits / $0; balance stays 279.6. |
| Accounting/runtime | PASS | Media jobs remain 709 with 0 queued / 0 running. API embedded runner is healthy with no issues. No provider submission, new media job, asset purchase, or credit movement occurred. |
| Automated verification | PASS | Phase 29 focused suite 128/128; full backend 895/895 in 257.49s. Storyboard genericity/hardcoding guard, `compileall`, and `git diff --check` pass. |
| Campaign code review | PASS | Pre-review and post-change delta are under `docs/reviews/20260716_220119/`. All three medium findings are resolved; no open critical/high/medium issue remains. |
| Scope preservation | PASS WITH DISCLOSED UI EVENT | No saved workflow, historical asset, Character, Environment, story field, topology, reference order, provider/model/pricing setting, or Frozen state was overwritten. Reloading an unsaved browser tab exposed a blank local New workflow tab; saved Sadis Adventures was reopened read-only and not saved. |
| Final disposition | DETERMINISTIC SIGNOFF | Phase 29 is complete. The only remaining optional gate is PAID-2908 for new same-contract Board 1-3 art-only sources and full visual inspection; it is not authorized. |
## Phase 30 glyph-safe metadata and paid trilogy proof

Date: 2026-07-17

| Check | Result | Evidence |
|---|---|---|
| Renderer regression | PASS | `test_renderer_keeps_two_line_metadata_glyphs_inside_row_rules` failed on the prior one-pixel clearance and passes after centering the actual multi-line glyph bounds. Canvas, rows, font sizes, and image rectangles are unchanged. |
| Deterministic proof | PASS | `tmp/phase30-proof/board-1-glyph-safe.png` passes original-resolution inspection; its six cinematic rectangles are pixel-identical to the pre-fix output. |
| Automated verification | PASS | The pre-paid gates passed 130 focused storyboard tests and the clean full backend suite at 897/897. After the audit correction, 7/7 quality-audit tests, 101/101 affected storyboard tests, and the complete backend suite at 898/898 pass. Compilation, recipe genericity/hardcoding, and diff checks pass. |
| Paid execution | PASS | `grun_c14f1f0b747a` completed `job_003f5c129f7b`, `job_aa86b0cde9b4`, and `job_2263a662aadd`. Balance moved 279.6 -> 249.6, exactly 30 credits / $0.15; no retry occurred. |
| Layout and glyph safety | PASS | All three composed outputs are 2048x1152 and share layout v4 plus the same header/panel/font/row geometry. Pixel inspection across all 90 metadata row slots finds 4-13 px lower clearance on every non-empty value; blank DIALOG remains valid. |
| Character, environment, story | PASS | The recurring covered pilot, weathered ship/hangar, repair route, cinematic treatment, causal 18-frame progression, both inter-board handoffs, dialogue, cockpit lift, and departure remain coherent. |
| Strict metadata/design review | FAIL STRICT | Board 2 Panel 2 repeats a CAMERA angle/lens clause. Bolts appears at the correct Board 3 reveal and is feline-faced, but the body is upright/human-shaped rather than the requested compact natural four-legged feline anatomy. |
| Formal audit | PASS DETERMINISTIC / VISUAL EXCEPTIONS | BUG-3009 makes the audit architecture-aware: typed specs and text-free art prompts now pass D001-D004/D010-D011. Manifest: `data/quality-manifests/grun_c14f1f0b747a.json`; visual review records V001 and V008 exceptions. |
| Browser/runtime closure | PASS WITH UI DEFECT | In-app Graph Studio shows the completed 23-node run, 249.6 credits, and approximately 0 credits / $0 after all three provider nodes were refrozen. Board 1/2 compositor previews open in-browser. Board 3's completed 2048x1152 reference exists and passed direct original-resolution inspection, but its node says `No preview yet`; BUG-3012 owns that display-only defect. API, runner, and queue remain healthy and empty. |
| Final disposition | CLIPPING ACCEPTED; GLOBAL ART SIGNOFF WITHHELD | Phase 30's reported two-line clipping is fixed and paid-proven. BUG-3011 is the proposed no-paid follow-up for within-row CAMERA deduplication and feline-body adherence before any separately authorized future proof. |
