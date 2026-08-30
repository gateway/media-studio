// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CreativeAssistantPanel } from "./creative-assistant-panel";
import {
  assistantJsonResponse as jsonResponse,
  assistantTestSession as session,
  assistantTestWorkflow as workflow,
} from "./creative-assistant-test-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAssistant() {
  vi.stubGlobal("fetch", vi.fn((request: RequestInfo | URL) => {
    const url = String(request);
    if (url.includes("/media/assistant/sessions?")) return jsonResponse({ items: [] });
    if (url.endsWith("/media/assistant/sessions")) return jsonResponse({ ...session, messages: [] });
    return jsonResponse({});
  }));

  render(
    <CreativeAssistantPanel
      open
      workspaceKey="shortcut-test"
      workflowId="workflow-1"
      workflowName="Assistant Graph"
      workflow={workflow}
      references={[]}
      importImageFile={vi.fn()}
      onApplyWorkflow={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

it("uses the existing minimized presentation for both the button and M hotkey", () => {
  renderAssistant();

  fireEvent.click(screen.getByRole("button", { name: "Collapse Media Assistant" }));
  expect(screen.getByRole("button", { name: "Expand Media Assistant" })).toBeTruthy();

  fireEvent.keyDown(window, { key: "m" });
  expect(screen.getByRole("button", { name: "Collapse Media Assistant" })).toBeTruthy();

  fireEvent.keyDown(window, { key: "m" });
  expect(screen.getByRole("button", { name: "Expand Media Assistant" })).toBeTruthy();
});

it("does not trigger the M hotkey while the user is typing", () => {
  renderAssistant();

  fireEvent.keyDown(screen.getByRole("textbox", { name: /assistant message/i }), { key: "m" });

  expect(screen.getByRole("button", { name: "Collapse Media Assistant" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Expand Media Assistant" })).toBeNull();
});
