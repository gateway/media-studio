// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsSectionTabs } from "@/components/settings/settings-section-tabs";

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

describe("SettingsSectionTabs", () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
  });

  it("renders the active tab as disabled and navigates to the inactive tab", () => {
    render(<SettingsSectionTabs activeTab="general" currentProjectId="proj_123" />);

    expect(screen.getByRole("button", { name: "General" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    expect(pushMock).toHaveBeenCalledWith("/settings/llms?project=proj_123");
  });
});
