// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { mobileComposerCollapsedForProgrammaticExpand, revealStudioComposer } from "@/lib/studio-composer-reveal";

function mockFocus(element: HTMLElement) {
  const focus = vi.fn();
  Object.defineProperty(element, "focus", {
    configurable: true,
    value: focus,
  });
  return focus;
}

describe("revealStudioComposer", () => {
  it("keeps programmatic expansion docked on non-coarse pointer devices", () => {
    expect(mobileComposerCollapsedForProgrammaticExpand(false)).toBe(true);
    expect(mobileComposerCollapsedForProgrammaticExpand(true)).toBe(false);
  });

  it("scrolls and focuses the prompt by default", () => {
    const composerRoot = document.createElement("section");
    const promptInput = document.createElement("textarea");
    const scrollIntoView = vi.fn();
    const promptFocus = mockFocus(promptInput);
    Object.defineProperty(composerRoot, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    revealStudioComposer({ composerRoot, promptInput });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "smooth" });
    expect(promptFocus).toHaveBeenCalledWith();
  });

  it("focuses preset fields without scrolling when requested", () => {
    const composerRoot = document.createElement("section");
    const presetInput = document.createElement("input");
    presetInput.placeholder = "Example: 1969 Camaro SS";
    const promptInput = document.createElement("textarea");
    composerRoot.append(presetInput);
    const scrollIntoView = vi.fn();
    const presetFocus = mockFocus(presetInput);
    const promptFocus = mockFocus(promptInput);
    Object.defineProperty(composerRoot, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    revealStudioComposer({ composerRoot, promptInput }, { focusPresetField: true, scroll: false });

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(presetFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(promptFocus).not.toHaveBeenCalled();
  });
});
