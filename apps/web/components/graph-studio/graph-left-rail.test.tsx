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
    assistantEnabled: false,
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
  it("hides the Media Assistant button by default", () => {
    renderRail();

    expect(screen.queryByTestId("graph-sidebar-assistant-button")).toBeNull();
  });

  it("shows and toggles the Media Assistant button when debug-enabled", () => {
    const onToggleAssistant = vi.fn();
    renderRail({ assistantEnabled: true, onToggleAssistant });

    fireEvent.click(screen.getByTestId("graph-sidebar-assistant-button"));

    expect(onToggleAssistant).toHaveBeenCalledTimes(1);
  });
});
