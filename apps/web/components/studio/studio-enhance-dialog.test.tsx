// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { StudioEnhanceDialog } from "./studio-enhance-dialog";

afterEach(cleanup);

function props() {
  return {
    open: true,
    previewVisual: "/existing-reference.png",
    userPrompt: "Original prompt",
    enhancedPrompt: "Enhanced result",
    imageAnalysisText: "Reference analysis",
    currentModelLabel: "Current model",
    currentPresetLabel: "Current preset",
    providerLabel: "Configured provider",
    providerModelId: "configured-model",
    modeLabel: "Prompt + image guidance",
    readinessLabel: "Provider ready",
    imageAnalysisStatus: "available",
    configuredForModel: true,
    hasSavedSystemPrompt: true,
    busy: false,
    error: null,
    warnings: [],
    onClose: vi.fn(),
    onRequestPreview: vi.fn(),
    onOpenSetup: vi.fn(),
    onUsePrompt: vi.fn(),
  };
}

it("keeps comparison, analysis and configured context while dispatching each existing action separately", () => {
  const callbacks = props();
  render(<StudioEnhanceDialog {...callbacks} />);
  expect(screen.getByRole("dialog", { name: "Prompt enhancer" })).toBeTruthy();
  expect(screen.getByText("Original prompt", { selector: "pre" })).toBeTruthy();
  expect(screen.getByText("Enhanced result")).toBeTruthy();
  expect(screen.getByText("configured-model")).toBeTruthy();
  const analysis = screen.getByText("Reference analysis").closest("details")!;
  expect(analysis.open).toBe(false);
  fireEvent.click(screen.getByText("Image analysis", { selector: "summary" }));
  expect(analysis.open).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Use prompt" }));
  expect(callbacks.onUsePrompt).toHaveBeenCalledOnce();
  expect(callbacks.onRequestPreview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(callbacks.onClose).toHaveBeenCalledOnce();
  expect(callbacks.onRequestPreview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enhance again" }));
  expect(callbacks.onRequestPreview).toHaveBeenCalledOnce();
});

it("retains busy/error/readiness guards and the existing setup callback", () => {
  const callbacks = props();
  const { rerender } = render(<StudioEnhanceDialog {...callbacks} busy />);
  expect(
    (screen.getByRole("button", { name: "Enhancing..." }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Use prompt" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(<StudioEnhanceDialog {...callbacks} error="Provider unavailable" />);
  expect(screen.getByRole("alert").textContent).toContain(
    "Provider unavailable",
  );
  expect(
    (screen.getByRole("button", { name: "Use prompt" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(
    <StudioEnhanceDialog
      {...callbacks}
      enhancedPrompt={null}
      hasSavedSystemPrompt={false}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "Enhance" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(<StudioEnhanceDialog {...callbacks} configuredForModel={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Set up enhancement" }));
  expect(callbacks.onOpenSetup).toHaveBeenCalledOnce();
  expect(callbacks.onRequestPreview).not.toHaveBeenCalled();
});

it("contains keyboard focus while open, closes with Escape and returns focus to the opener", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const callbacks = props();
  const { rerender, unmount } = render(
    <StudioEnhanceDialog {...callbacks} open={false} />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<StudioEnhanceDialog {...callbacks} />);
  expect(document.activeElement).toBe(screen.getByRole("dialog"));
  opener.focus();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Close prompt enhancer" }),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(callbacks.onClose).toHaveBeenCalledOnce();
  rerender(<StudioEnhanceDialog {...callbacks} open={false} />);
  expect(document.activeElement).toBe(opener);
  unmount();
  opener.remove();
});

it("returns focus to the current opener after a previous opener was replaced between sessions", () => {
  const first = document.createElement("button");
  document.body.append(first);
  first.focus();
  const callbacks = props();
  const { rerender } = render(<StudioEnhanceDialog {...callbacks} />);
  rerender(<StudioEnhanceDialog {...callbacks} open={false} />);
  expect(document.activeElement).toBe(first);
  first.remove();

  const replacement = document.createElement("button");
  document.body.append(replacement);
  replacement.focus();
  rerender(<StudioEnhanceDialog {...callbacks} />);
  expect(document.activeElement).toBe(screen.getByRole("dialog"));
  rerender(<StudioEnhanceDialog {...callbacks} open={false} />);
  expect(document.activeElement).toBe(replacement);
  replacement.remove();
});
