// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioComposer } from "@/components/studio/studio-composer";

function renderComposer(options: { collapsed?: boolean; mobileExpanded?: boolean; onToggle?: () => void } = {}) {
  return render(
    <StudioComposer
      immersive={false}
      composerCollapsed={options.collapsed ?? false}
      mobileComposerCollapsed={!options.mobileExpanded}
      mobileComposerExpanded={options.mobileExpanded ?? false}
      currentModelLabel="Nano Banana Pro"
      formattedRemainingCredits="5.8k"
      estimatedCredits="~6 cr"
      structuredPresetActive={false}
      presetLabel={null}
      externalTopContent={<div>Seedance reference strip</div>}
      mobileInputsContent={<div>Mobile reference inputs</div>}
      sourceAttachmentStrip={<div>Source attachment strip</div>}
      floatingComposerStatus={null}
      onToggleCollapsed={vi.fn()}
      onToggleComposerCollapsed={options.onToggle ?? vi.fn()}
    >
      <div>Prompt and model controls</div>
    </StudioComposer>,
  );
}

describe("StudioComposer", () => {
  afterEach(() => {
    cleanup();
  });

  it("collapses the full desktop composer payload into a compact bar", () => {
    renderComposer({ collapsed: true });

    expect(screen.getByText("Composer collapsed")).toBeTruthy();
    expect(screen.getByText("Nano Banana Pro")).toBeTruthy();
    expect(screen.queryByText("Seedance reference strip")).toBeNull();
    expect(screen.queryByText("Source attachment strip")).toBeNull();
    expect(screen.queryByText("Prompt and model controls")).toBeNull();
  });

  it("calls the composer-level expand handler from the collapsed bar", () => {
    const onToggle = vi.fn();
    renderComposer({ collapsed: true, onToggle });

    fireEvent.click(screen.getByRole("button", { name: "Expand Studio composer" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps the full composer visible when expanded", () => {
    renderComposer({ collapsed: false });

    expect(screen.getByRole("button", { name: "Collapse Studio composer" })).toBeTruthy();
    expect(screen.getByText("Seedance reference strip")).toBeTruthy();
    expect(screen.getByText("Source attachment strip")).toBeTruthy();
    expect(screen.getByText("Prompt and model controls")).toBeTruthy();
  });

  it("keeps mobile-expanded composer state dockable on desktop", () => {
    const { container } = renderComposer({ collapsed: false, mobileExpanded: true });
    const composerShell = container.firstElementChild;

    expect(composerShell?.className).not.toContain("overlay-backdrop");
    expect(composerShell?.className).toContain("lg:absolute");
    expect(composerShell?.className).toContain("lg:top-auto");
    expect(composerShell?.className).toContain("lg:bottom-6");
    expect(screen.getByText("Seedance reference strip").parentElement?.className).toContain("lg:block");
  });
});
