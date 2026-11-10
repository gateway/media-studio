// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioComposer } from "@/components/studio/studio-composer";

function renderComposer(
  options: {
    collapsed?: boolean;
    mobileExpanded?: boolean;
    immersive?: boolean;
    onToggle?: () => void;
    onToggleMobile?: () => void;
  } = {},
) {
  return render(
    <StudioComposer
      immersive={options.immersive ?? false}
      modelPicker={
        options.immersive ? (
          <button type="button">Nano Banana Pro</button>
        ) : null
      }
      composerCollapsed={options.collapsed ?? false}
      mobileComposerCollapsed={!options.mobileExpanded}
      mobileComposerExpanded={options.mobileExpanded ?? false}
      currentModelLabel="Nano Banana Pro"
      formattedRemainingCredits="5.8k"
      estimatedCredits="~6 cr"
      structuredPresetActive={false}
      presetLabel={null}
      referenceInputs={<div>Seedance reference strip</div>}
      mobileInputsContent={<div>Mobile reference inputs</div>}
      sourceAttachmentStrip={<div>Source attachment strip</div>}
      floatingComposerStatus={null}
      onToggleCollapsed={options.onToggleMobile ?? vi.fn()}
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
    expect(screen.getByText("5.8k")).toBeTruthy();
    expect(screen.queryByText("Seedance reference strip")).toBeNull();
    expect(screen.queryByText("Source attachment strip")).toBeNull();
    expect(screen.queryByText("Prompt and model controls")).toBeNull();
  });

  it("omits the duplicate balance from the collapsed immersive composer", () => {
    const { container } = renderComposer({
      immersive: true,
      collapsed: true,
      mobileExpanded: true,
    });

    expect(
      container.firstElementChild?.getAttribute("data-mobile-overlay-expanded"),
    ).toBe("false");
    expect(screen.queryByText("5.8k")).toBeNull();
    expect(screen.queryByText("1,066.6 credits")).toBeNull();
    expect(screen.getByText("~6 cr")).toBeTruthy();
  });

  it("calls the composer-level expand handler from the collapsed bar", () => {
    const onToggle = vi.fn();
    renderComposer({ collapsed: true, onToggle });

    fireEvent.click(
      screen.getByRole("button", { name: "Expand Studio composer" }),
    );

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps the full composer visible when expanded", () => {
    renderComposer({ collapsed: false });

    expect(
      screen.getByRole("button", { name: "Collapse Studio composer" }),
    ).toBeTruthy();
    expect(screen.getByText("Seedance reference strip")).toBeTruthy();
    expect(screen.getByText("Source attachment strip")).toBeTruthy();
    expect(screen.getByText("Prompt and model controls")).toBeTruthy();
  });

  it("keeps mobile-expanded composer state dockable on desktop", () => {
    const { container } = renderComposer({
      collapsed: false,
      mobileExpanded: true,
    });
    const composerShell = container.firstElementChild;

    expect(composerShell?.className).not.toContain("overlay-backdrop");
    expect(composerShell?.className).toContain("lg:absolute");
    expect(composerShell?.className).toContain("lg:top-auto");
    expect(composerShell?.className).toContain("lg:bottom-6");
    expect(screen.getAllByText("Seedance reference strip")).toHaveLength(1);
    expect(
      screen.getByText("Seedance reference strip").parentElement?.className,
    ).toContain("studio-composer-body");
  });
  it("shows one model picker and leaves balance to the header in expanded mobile chrome", () => {
    const onToggleMobile = vi.fn();
    renderComposer({ immersive: true, mobileExpanded: true, onToggleMobile });
    expect(screen.getAllByText("Nano Banana Pro")).toHaveLength(1);
    expect(screen.queryByText("Prompt composer")).toBeNull();
    expect(screen.queryByText("1,066.6 credits")).toBeNull();
    expect(screen.queryByText("~6 cr")).toBeNull();

    const collapse = screen.getByRole("button", {
      name: "Collapse prompt composer",
      expanded: true,
    });
    fireEvent.click(collapse);
    expect(onToggleMobile).toHaveBeenCalledOnce();
  });
});
