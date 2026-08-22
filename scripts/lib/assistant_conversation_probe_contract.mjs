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
