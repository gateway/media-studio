import { afterEach, describe, expect, it } from "vitest";

import {
  isGraphAssistantAvailable,
  isGraphAssistantDebugEnabled,
} from "./graph-assistant-debug";

const originalValue = process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG;

afterEach(() => {
  if (originalValue == null) {
    delete process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG;
  } else {
    process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG = originalValue;
  }
});

describe("isGraphAssistantDebugEnabled", () => {
  it("is disabled by default", () => {
    delete process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG;

    expect(isGraphAssistantDebugEnabled()).toBe(false);
  });

  it("is enabled only by the explicit debug flag", () => {
    process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG = "1";

    expect(isGraphAssistantDebugEnabled()).toBe(true);

    process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG = "true";

    expect(isGraphAssistantDebugEnabled()).toBe(false);
  });
});

describe("isGraphAssistantAvailable", () => {
  it("requires the debug flag and a proven Codex Local connection", () => {
    delete process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG;

    expect(isGraphAssistantAvailable({ codex_local_ready: true })).toBe(false);

    process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG = "1";

    expect(isGraphAssistantAvailable(null)).toBe(false);
    expect(isGraphAssistantAvailable({})).toBe(false);
    expect(isGraphAssistantAvailable({ codex_local_ready: false })).toBe(false);
    expect(isGraphAssistantAvailable({ codex_local_ready: true })).toBe(true);
  });
});
