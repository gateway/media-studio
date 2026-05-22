// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { readStudioComposerDraft, writeStudioComposerDraft, type StudioComposerDraft } from "@/lib/studio-composer-draft";

const originalSessionStorage = window.sessionStorage;

function draft(overrides: Partial<StudioComposerDraft> = {}): StudioComposerDraft {
  return {
    sourceAssetId: null,
    modelKey: "gpt-image-2-text-to-image",
    selectedPresetId: "",
    selectedPromptIds: [],
    prompt: "A clean test prompt",
    presetInputValues: {},
    presetSlotStates: {},
    optionValues: {},
    attachments: [],
    stagedSourceAssetSnapshot: null,
    outputCount: 1,
    lastNanoPresetModelKey: "nano-banana-2",
    ...overrides,
  };
}

describe("studio composer draft storage", () => {
  afterEach(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage,
    });
    window.__mediaStudioComposerDraft = null;
    originalSessionStorage.clear();
  });

  it("keeps the in-memory draft usable when session storage is unavailable", () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: undefined,
    });

    expect(() => writeStudioComposerDraft(draft({ prompt: "Survives embedded browser storage gaps" }))).not.toThrow();

    expect(readStudioComposerDraft()?.prompt).toBe("Survives embedded browser storage gaps");
  });
});
