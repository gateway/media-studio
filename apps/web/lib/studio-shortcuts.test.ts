import { describe, expect, it } from "vitest";

import { resolveStudioShortcutAction } from "./studio-shortcuts";

describe("studio shortcuts", () => {
  it("maps gallery shortcuts to Graph Studio and projects", () => {
    expect(resolveStudioShortcutAction({ key: "g", hasModifier: false, typing: false, overlayOpen: false })).toBe("open-graph");
    expect(resolveStudioShortcutAction({ key: "p", hasModifier: false, typing: false, overlayOpen: false })).toBe("open-projects");
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
