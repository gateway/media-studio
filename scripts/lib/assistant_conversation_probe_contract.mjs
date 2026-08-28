const bannedVocabulary = [
  "sandbox",
  "plan card",
  "reviewable workflow",
  "assistant_prompt_route",
  "provider_",
  "codex_local",
  "node_ref",
  "chain-of-thought",
  "create_workflow",
  "create_prompt_recipe",
  "create_media_preset",
  "plan_graph",
];

const confirmedActionKinds = new Set([
  "confirm_graph",
  "save_media_preset",
  "save_prompt_recipe",
  "apply_repair",
  "run_workflow",
]);

export function planPreviewFromSession(session, mechanical) {
  if (!mechanical?.plan_preview) return null;
  return session?.latest_plan && typeof session.latest_plan === "object"
    ? session.latest_plan
    : null;
}

export function workflowForProbeSession(workflow, sessionKey) {
  return {
    ...workflow,
    workflow_id: `conversation-probe-${sessionKey}`,
  };
}

function plainWordCount(text) {
  return String(text || "")
    .replace(/[`*_>#-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function presentationAnomalies(text) {
  const value = String(text || "");
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const anomalies = [];
  if (value.includes("MEDIA_ASSISTANT_") || value.includes("REFERENCE_STYLE_")) {
    anomalies.push("internal_marker");
  }
  if (lines.at(-1)?.startsWith("-") && lines.at(-1)?.endsWith("?")) {
    anomalies.push("question_embedded_in_list");
  }
  if (/\{\s*"(?:mode|assistant_prompt_route|provider_kind)"/.test(value)) {
    anomalies.push("raw_internal_json");
  }
  return anomalies;
}

export function toolCallsFromTrace(trace) {
  if (!trace || typeof trace !== "object") return [];
  return Array.isArray(trace.tool_calls) ? trace.tool_calls : [];
}

function kernelTraceFromContent(contentJson) {
  const kernelTrace = contentJson?.kernel_turn?.trace;
  if (kernelTrace && typeof kernelTrace === "object") return kernelTrace;
  const summaryTrace = contentJson?.assistant_turn_trace;
  return summaryTrace && typeof summaryTrace === "object" ? summaryTrace : {};
}

function typedToolCall(call) {
  return Boolean(
    call
    && typeof call === "object"
    && typeof call.tool_name === "string"
    && call.tool_name.length > 0
    && typeof call.arguments_hash === "string"
    && call.arguments_hash.length > 0
    && Number.isInteger(call.duration_ms)
    && call.duration_ms >= 0
    && Number.isInteger(call.result_size_bytes)
    && call.result_size_bytes >= 0,
  );
}

function typedNextAction(
  nextAction,
  legacySuggestedAction,
  expectNoNextAction,
  expectConfirmation,
) {
  if (nextAction === null || nextAction === undefined) {
    if (expectConfirmation) return false;
    return Boolean(expectNoNextAction) || !legacySuggestedAction;
  }
  if (typeof nextAction !== "object" || Array.isArray(nextAction)) return false;
  if (nextAction.kind === "none") {
    return !expectConfirmation
      && nextAction.requires_confirmation === false
      && !nextAction.confirmation_token;
  }
  return confirmedActionKinds.has(nextAction.kind)
    && typeof nextAction.label === "string"
    && nextAction.label.length > 0
    && typeof nextAction.confirmation_token === "string"
    && nextAction.confirmation_token.length > 0
    && nextAction.requires_confirmation === true
    && nextAction.payload !== null
    && typeof nextAction.payload === "object"
    && !Array.isArray(nextAction.payload);
}

function workflowPreviewIsAcceptable(plan, nextAction) {
  const confirmable = plan?.plan?.status === "validated"
    && nextAction?.kind === "confirm_graph"
    && nextAction?.requires_confirmation === true;
  if (!confirmable) return false;
  if (plan?.validation?.valid) return true;
  const errors = plan?.validation?.errors;
  return Array.isArray(errors)
    && errors.length > 0
    && errors.every((error) => error?.code === "missing_media_reference");
}

export function evaluateMechanicalTurn({
  scenario,
  reply,
  contentJson,
  plan,
  jobsBefore,
  jobsAfter,
}) {
  const lower = String(reply || "").toLowerCase();
  const bannedHits = bannedVocabulary.filter((term) => lower.includes(term));
  const wordCount = plainWordCount(reply);
  const configuredMaxWords = scenario.mechanical.max_reply_words;
  const maxWords = Number.isInteger(configuredMaxWords) && configuredMaxWords > 0
    ? configuredMaxWords
    : 150;
  const trace = kernelTraceFromContent(contentJson);
  const summaryTrace = contentJson?.assistant_turn_trace ?? {};
  const toolCalls = toolCallsFromTrace(trace);
  const malformedToolCalls = toolCalls.filter((call) => !typedToolCall(call));
  const nextAction = contentJson?.next_action ?? null;
  const legacySuggestedAction = contentJson?.suggested_action ?? null;
  const actionShapeValid = typedNextAction(
    nextAction,
    legacySuggestedAction,
    scenario.mechanical.expect_no_next_action,
    scenario.mechanical.expect_confirmation,
  );
  const price = plan?.pricing?.pricing_summary?.total ?? null;
  const providerSteps = Array.isArray(trace.provider_steps) ? trace.provider_steps : [];
  const processSpawns = providerSteps.filter(
    (step) => step?.process_lifecycle === "process_spawned",
  ).length;
  const reportedProcessSpawns = summaryTrace.provider_process_spawns;
  const lifecycleShapeValid = providerSteps.length > 0
    && providerSteps.every(
      (step) => typeof step?.provider_thread_id === "string"
        && step.provider_thread_id.length > 0
        && ["process_spawned", "process_reused"].includes(step.process_lifecycle),
    )
    && processSpawns <= 1
    && (
      reportedProcessSpawns === undefined
      || Number(reportedProcessSpawns) === processSpawns
    );
  const maxToolSteps = Number(scenario.mechanical.max_tool_steps ?? 6);
  const stepCount = trace.step_count;
  const termination = String(trace.termination || "");
  const pendingErrorCodes = Array.isArray(plan?.validation?.errors)
    ? plan.validation.errors.map((error) => error?.code ?? null)
    : [];
  const stepLimitValid = Number.isInteger(stepCount)
    && stepCount >= 0
    && stepCount <= maxToolSteps
    && !["step_budget_exhausted", "wall_clock_budget_exhausted"].includes(termination);
  const checks = {
    banned_vocabulary: { pass: bannedHits.length === 0, hits: bannedHits },
    reply_length: { pass: wordCount <= maxWords, words: wordCount, max_words: maxWords },
    presentation: {
      pass: presentationAnomalies(reply).length === 0,
      anomalies: presentationAnomalies(reply),
    },
    typed_actions: {
      pass: malformedToolCalls.length === 0,
      tool_call_count: toolCalls.length,
      malformed_tool_call_count: malformedToolCalls.length,
    },
    tool_evidence: {
      pass: !scenario.mechanical.require_tool_evidence
        || (toolCalls.length > 0 && malformedToolCalls.length === 0),
      required: Boolean(scenario.mechanical.require_tool_evidence),
      tool_call_count: toolCalls.length,
    },
    action_shape: {
      pass: actionShapeValid,
      next_action: nextAction,
      legacy_suggested_action: legacySuggestedAction,
    },
    workflow_validity: {
      pass: !scenario.mechanical.plan_preview || workflowPreviewIsAcceptable(plan, nextAction),
      checked: Boolean(scenario.mechanical.plan_preview),
      valid: plan?.validation?.valid ?? null,
      pending_error_codes: pendingErrorCodes,
    },
    price_present: {
      pass: !scenario.mechanical.plan_preview || price !== null,
      checked: Boolean(scenario.mechanical.plan_preview),
      price,
    },
    process_lifecycle: {
      pass: lifecycleShapeValid,
      provider_step_count: providerSteps.length,
      process_spawns: processSpawns,
      reported_process_spawns: reportedProcessSpawns ?? null,
    },
    step_limit: {
      pass: stepLimitValid,
      step_count: stepCount,
      max_tool_steps: maxToolSteps,
      termination,
    },
    no_unconfirmed_mutation: {
      pass: plan?.plan?.status !== "applied" && jobsAfter === jobsBefore,
      plan_status: plan?.plan?.status ?? null,
      jobs_before: jobsBefore,
      jobs_after: jobsAfter,
    },
    confirmation: {
      pass: !scenario.mechanical.expect_confirmation || Boolean(
        actionShapeValid
        && nextAction?.kind !== "none"
        && nextAction?.requires_confirmation === true,
      ),
      required: Boolean(scenario.mechanical.expect_confirmation),
    },
  };
  return {
    ...checks,
    pass: Object.values(checks).every((check) => check.pass),
  };
}
