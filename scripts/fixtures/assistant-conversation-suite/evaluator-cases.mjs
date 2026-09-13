// Independent data cases shared by the Node contract suite and local browser QA.
function turn() {
  return {
    scenario: {mechanical: {required_artifact_kind: "preset_draft"}},
    reply: "A draft is ready for your review.",
    contentJson: {next_action: {kind: "none", requires_confirmation: false}, kernel_turn: {
      artifacts: [], trace: {provider_steps: [{provider_thread_id: "fixture", process_lifecycle: "process_spawned"}],
        tool_calls: [], step_count: 1, termination: "completed"},
    }},
    plan: null, jobsBefore: 0, jobsAfter: 0,
  };
}
function draft(kind = "preset_draft") {
  return {kind, data: {proposal_id: "proposal-fixture", draft: {name: "Independent draft"}, validation: {valid: true}}};
}
export function measurementCases() {
  const missing = turn();
  const valid = turn(); valid.contentJson.kernel_turn.artifacts = [draft()];
  const recipe = turn(); recipe.scenario.mechanical.required_artifact_kind = "recipe_draft";
  recipe.contentJson.kernel_turn.artifacts = [draft("recipe_draft")];
  const wrongKind = turn(); wrongKind.contentJson.kernel_turn.artifacts = [draft("recipe_draft")];
  const invalid = turn(); invalid.contentJson.kernel_turn.artifacts = [draft()];
  invalid.contentJson.kernel_turn.artifacts[0].data.validation.valid = false;
  const empty = turn(); empty.contentJson.kernel_turn.artifacts = [draft()];
  empty.contentJson.kernel_turn.artifacts[0].data.draft = {};
  const forbiddenAction = turn(); forbiddenAction.scenario.mechanical = {expect_no_next_action: true};
  forbiddenAction.contentJson.next_action = {kind: "save_media_preset", label: "Save", confirmation_token: "fixture", requires_confirmation: true, payload: {}};
  const legacyAbsent = turn(); legacyAbsent.scenario.mechanical = {expect_no_next_action: true};
  delete legacyAbsent.contentJson.next_action;
  legacyAbsent.contentJson.suggested_action = "save_media_preset";
  const legacyNone = turn(); legacyNone.scenario.mechanical = {expect_no_next_action: true};
  legacyNone.contentJson.suggested_action = "save_media_preset";
  const readyWithoutAction = turn(); readyWithoutAction.scenario.mechanical = {expect_save_unavailable: true};
  readyWithoutAction.contentJson.kernel_turn.artifacts = [draft()];
  readyWithoutAction.contentJson.kernel_turn.artifacts[0].data.save_ready = true;
  const unknownJobs = turn(); delete unknownJobs.jobsBefore; delete unknownJobs.jobsAfter;
  const clarification = turn(); delete clarification.scenario.mechanical.required_artifact_kind;
  return [
    {name: "Missing typed draft cannot complete P1", input: missing, check: "requested_artifact", expected: false},
    {name: "Validated preset draft completes artifact boundary", input: valid, check: "requested_artifact", expected: true},
    {name: "Validated recipe draft completes R2 boundary", input: recipe, check: "requested_artifact", expected: true},
    {name: "Wrong artifact kind is not completion", input: wrongKind, check: "requested_artifact", expected: false},
    {name: "Invalid draft is not completion", input: invalid, check: "requested_artifact", expected: false},
    {name: "Empty draft is not completion", input: empty, check: "requested_artifact", expected: false},
    {name: "P5 cannot pass with a forbidden save action", input: forbiddenAction, check: "action_shape", expected: false},
    {name: "Legacy save offer fails when next_action is absent", input: legacyAbsent, check: "action_shape", expected: false},
    {name: "Legacy save offer fails beside kind none", input: legacyNone, check: "action_shape", expected: false},
    {name: "P5 rejects typed save readiness even without an action", input: readyWithoutAction, check: "save_readiness", expected: false},
    {name: "Missing job evidence cannot prove no mutation", input: unknownJobs, check: "no_unconfirmed_mutation", expected: false},
    {name: "Clarification usefulness stays with browser review", input: clarification, check: "requested_artifact", expected: true},
  ];
}
