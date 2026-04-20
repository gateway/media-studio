import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseSavedEnhancementConfig,
  saveGlobalQueueSettingsRequest,
  saveModelQueuePolicyRequest,
  upsertEnhancementConfigEntry,
} from "./media-model-admin";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("media-model-admin", () => {
  it("upserts enhancement configs by model key", () => {
    const list = [
      { model_key: "nano-banana-2", label: "Old" },
      { model_key: "seedance-2.0", label: "Seedance" },
    ] as never;
    const next = upsertEnhancementConfigEntry(list, { model_key: "nano-banana-2", label: "New" } as never);

    expect(next.map((entry) => entry.label)).toEqual(["New", "Seedance"]);
  });

  it("parses saved enhancement configs from both wrapped and direct responses", () => {
    expect(parseSavedEnhancementConfig({ config: { model_key: "nano-banana-2" } as never })).toMatchObject({
      model_key: "nano-banana-2",
    });
    expect(parseSavedEnhancementConfig({ model_key: "seedance-2.0" } as never)).toMatchObject({
      model_key: "seedance-2.0",
    });
  });

  it("normalizes queue settings saves through the shared request helper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, settings: { max_concurrent_jobs: 2, queue_enabled: true, default_poll_seconds: 8, max_retry_attempts: 3 } }),
      }),
    );

    const result = await saveGlobalQueueSettingsRequest({
      max_concurrent_jobs: 2,
      queue_enabled: true,
      default_poll_seconds: 8,
      max_retry_attempts: 3,
    } as never);

    expect(result.ok).toBe(true);
    expect(result.settings).toMatchObject({ max_concurrent_jobs: 2, queue_enabled: true });
  });

  it("clamps model queue policy saves through the shared request helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, policy: { model_key: "nano-banana-2", enabled: true, max_outputs_per_run: 4 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveModelQueuePolicyRequest("nano-banana-2", true, 999);

    expect(result.ok).toBe(true);
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("/api/control/media-queue-policies/nano-banana-2");
    expect(JSON.parse(request[1].body)).toMatchObject({ enabled: true, max_outputs_per_run: 10 });
  });
});
