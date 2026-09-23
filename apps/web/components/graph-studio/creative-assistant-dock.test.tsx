// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { useAssistantDock } from "./hooks/use-assistant-dock";
import { assistantJsonResponse as jsonResponse, assistantTestSession as session, assistantTestWorkflow as workflow } from "./creative-assistant-test-fixtures";

let measure: (width: number) => void;
const onApply = vi.fn();
const onRun = vi.fn();
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: (entries: unknown[]) => void) { measure = (width) => callback([{ contentRect: { width } }]); }
    observe() { measure(1200); }
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function Harness() {
  const [open, setOpen] = useState(true);
  const dock = useAssistantDock(open);
  return <main ref={dock.containerRef}>
    <button onClick={() => setOpen(true)}>Reopen</button>
    <CreativeAssistantPanel open={open} dock={dock} workspaceKey="dock-test" workflowId="workflow-1"
      workflowName={workflow.name} workflow={workflow} references={[]} importImageFile={vi.fn()}
      onApplyWorkflow={onApply} onRunWorkflow={onRun} onClose={() => setOpen(false)} />
  </main>;
}
function changeLayout() {
  fireEvent.change(screen.getByLabelText("Assistant placement"), { target: { value: "floating" } });
  fireEvent.change(screen.getByLabelText("Assistant placement"), { target: { value: "right" } });
  fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
  act(() => measure(700)); act(() => measure(1200));
  fireEvent.click(screen.getByRole("button", { name: "Collapse Media Assistant" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Media Assistant" }));
  fireEvent.click(screen.getByRole("button", { name: "Close Media Assistant" }));
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
}
it("keeps one in-flight turn, the composer node and draft across placement/size/visibility changes, then stops it", async () => {
  let creates = 0; let turns = 0; let cancels = 0;
  const fetchMock = vi.fn((request: RequestInfo | URL) => {
    const url = String(request);
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) { creates++; return jsonResponse({ ...session, messages: [] }); }
    if (url.endsWith("/messages")) { turns++; return new Promise<Response>(() => {}); }
    if (url.endsWith("/cancel")) { cancels++; return jsonResponse({ ...session, messages: [] }); }
    return jsonResponse({ ...session, messages: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { container } = render(<Harness />);
  const composer = screen.getByRole("textbox", { name: "Assistant message" });
  fireEvent.change(composer, { target: { value: "Mock request" } });
  fireEvent.click(screen.getByRole("button", { name: "Send chat message" }));
  await waitFor(() => expect(turns).toBe(1));
  fireEvent.change(composer, { target: { value: "Keep this unsent draft" } });
  const body = container.querySelector('.graph-assistant-body')!;
  Object.defineProperties(body, { scrollHeight: { value: 500 }, clientHeight: { value: 100 } });
  body.scrollTop = 37;
  fireEvent.scroll(body);
  changeLayout();
  expect(screen.getByRole("textbox", { name: "Assistant message" })).toBe(composer);
  expect((composer as HTMLTextAreaElement).value).toBe("Keep this unsent draft");
  expect(container.querySelector('.graph-assistant-body')).toBe(body);
  expect(body.scrollTop).toBe(37);
  expect(creates).toBe(1); expect(turns).toBe(1);
  expect(screen.getByRole("button", { name: "Stop assistant request" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stop assistant request" }));
  await waitFor(() => expect(cancels).toBe(1));
  expect(onApply).not.toHaveBeenCalled(); expect(onRun).not.toHaveBeenCalled();
});
it("retains attachments, messages and pending explicit confirmation without applying or submitting a graph", async () => {
  const saved = { ...session,
    attachments: [{ assistant_attachment_id: "attachment-1", reference_id: "reference-1", kind: "image", label: "Existing reference" }],
    messages: [{ assistant_message_id: "pending", assistant_session_id: "session-1", role: "assistant", content_text: "Review before running.", content_json: {
      mode: "assistant_kernel", next_action: { kind: "run_workflow", label: "Review and run", requires_confirmation: true, confirmation_token: "test-token", payload: { confirmation_token: "test-token" }, price_estimate: { pricing_summary: { total: { estimated_credits: 0, estimated_cost_usd: 0 } } } },
    } }],
  };
  const fetchMock = vi.fn((request: RequestInfo | URL) => {
    const url = String(request);
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [saved] });
    return jsonResponse(saved);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<Harness />);
  await screen.findByText("Review before running.");
  const confirmation = screen.getByRole("button", { name: "Review and run" });
  const attachment = screen.getByTestId('graph-assistant-reference-thumb-attachment-1');
  changeLayout();
  expect(screen.getByTestId('graph-assistant-reference-thumb-attachment-1')).toBe(attachment);
  expect(screen.getByRole("button", { name: "Review and run" })).toBe(confirmation);
  expect(onApply).not.toHaveBeenCalled(); expect(onRun).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/run-confirmations') || String(url).endsWith('/messages'))).toBe(false);
});
