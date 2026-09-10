// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphLeftRail } from "./graph-left-rail";

afterEach(() => {
  cleanup();
});

function renderRail(overrides: Partial<Parameters<typeof GraphLeftRail>[0]> = {}) {
  const props: Parameters<typeof GraphLeftRail>[0] = {
    sidebarDialog: null,
    showMiniMap: false,
    consoleOpen: false,
    assistantOpen: false,
    galleryHref: "/studio",
    onToggleDialog: vi.fn(),
    onToggleMiniMap: vi.fn(),
    onToggleConsole: vi.fn(),
    onToggleAssistant: vi.fn(),
    ...overrides,
  };
  return { ...render(<GraphLeftRail {...props} />), props };
}

describe("GraphLeftRail", () => {
  it("keeps the Media Assistant setup entry discoverable by default", () => {
    renderRail();

    expect(screen.getByRole("button", { name: "Show Media Assistant" })).toBeTruthy();
  });

  it("toggles the Media Assistant entry", () => {
    const onToggleAssistant = vi.fn();
    renderRail({ onToggleAssistant });

    fireEvent.click(screen.getByTestId("graph-sidebar-assistant-button"));

    expect(onToggleAssistant).toHaveBeenCalledTimes(1);
  });
});
