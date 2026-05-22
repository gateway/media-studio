import { describe, expect, it } from "vitest";

import { resolveStudioShortcutAction } from "./studio-shortcuts";

describe("studio shortcuts", () => {
  it("maps gallery shortcuts to projects, presets, and Graph Studio", () => {
    expect(resolveStudioShortcutAction({ key: "g", hasModifier: false, typing: false, overlayOpen: false })).toBe("open-projects");
    expect(resolveStudioShortcutAction({ key: "p", hasModifier: false, typing: false, overlayOpen: false })).toBe("open-presets");
    expect(resolveStudioShortcutAction({ key: "n", hasModifier: false, typing: false, overlayOpen: false })).toBe("open-graph");
  });

  it("keeps shortcuts out of form fields, overlays, and modifier chords", () => {
    expect(resolveStudioShortcutAction({ key: "g", hasModifier: true, typing: false, overlayOpen: false })).toBeNull();
    expect(resolveStudioShortcutAction({ key: "g", hasModifier: false, typing: true, overlayOpen: false })).toBeNull();
    expect(resolveStudioShortcutAction({ key: "p", hasModifier: false, typing: false, overlayOpen: true })).toBeNull();
  });

  it("keeps settings and library shortcuts available", () => {
    expect(resolveStudioShortcutAction({ key: "s", hasModifier: false, typing: false, overlayOpen: false })).toBe("open-settings");
    expect(resolveStudioShortcutAction({ key: "i", hasModifier: false, typing: false, overlayOpen: false })).toBe("open-library");
  });
});
