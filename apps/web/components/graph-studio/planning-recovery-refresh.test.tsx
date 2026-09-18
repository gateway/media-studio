// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { assistantJsonResponse as jsonResponse, assistantTestSession as session, assistantTestWorkflow as workflow } from "./creative-assistant-test-fixtures";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage?.clear?.(); });

it("refreshes the rotated checkpoint after a failed continuation", async () => {
  const checkpoint = { id: "old-id", state: "offered", workflow_name: "Board", request: "Build storyboard" };
  const initial = { ...session, messages: [], summary_json: { kernel_planning_recovery: checkpoint } };
  const refreshed = { ...initial, summary_json: { kernel_planning_recovery: { ...checkpoint, id: "retry-id" } } };
  const sent: string[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [initial] });
    if (url.endsWith("/messages")) {
      sent.push(String(init?.body));
      return sent.length === 1 ? Promise.resolve(new Response(JSON.stringify({ detail: "Provider interrupted" }), { status: 502, headers: { "Content-Type": "application/json" } })) : jsonResponse(refreshed);
    }
    if (url.endsWith("/sessions/session-1")) return jsonResponse(refreshed);
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<CreativeAssistantPanel open workspaceKey="tab-recovery" workflowId="workflow-1" workflowName="Board" workflow={workflow} references={[]} importImageFile={vi.fn()} onApplyWorkflow={vi.fn()} onRunWorkflow={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue planning" }));
  await screen.findByText("Provider interrupted");
  await waitFor(() => expect((screen.getByRole("button", { name: "Continue planning" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Continue planning" }));
  await waitFor(() => expect(sent.length).toBe(2));
  expect(JSON.parse(sent[1]).metadata.planning_recovery_id).toBe("retry-id");
});
