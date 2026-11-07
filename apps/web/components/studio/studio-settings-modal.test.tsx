// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { StudioSettingsModal } from "./studio-settings-modal";
import type { MediaModelSummary } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the embedded model/system-prompt forms and closes without sending configuration requests", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  const onClose = vi.fn();
  const model = {
    key: "existing-model",
    label: "Existing model",
    provider_model: "existing-model",
    task_modes: ["image_generation"],
    generation_kind: "image",
    input_patterns: ["prompt_only"],
    defaults: {},
    capability_summary: [],
    spend_notes: [],
  } as MediaModelSummary;
  render(
    <StudioSettingsModal
      models={[model]}
      presets={[]}
      enhancementConfigs={[]}
      initialSelectedModelKey={model.key}
      onClose={onClose}
    />,
  );
  expect(screen.getByRole("dialog", { name: "Studio Settings" })).toBeTruthy();
  expect(screen.getByText("Model Setup")).toBeTruthy();
  expect(screen.queryByText("Queue Settings")).toBeNull();
  expect(screen.queryByText("Structured Presets")).toBeNull();
  fireEvent.click(screen.getByText("Prompt Instructions").closest("summary")!);
  expect(
    screen.getByPlaceholderText(
      "Explain how prompts should be rewritten for this model.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Save system prompt" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(fetchMock).not.toHaveBeenCalled();
});
