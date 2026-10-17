import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { getMediaDashboardSnapshot, getStudioSnapshot } from "@/lib/control-api";
import { decodeStudioGalleryCursor } from "@/lib/studio-gallery-cursor";

afterEach(() => vi.unstubAllGlobals());

function api(overrides: Record<string, () => Response> = {}) {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const parsed = new URL(url);
    paths.push(parsed.pathname + parsed.search);
    if (overrides[parsed.pathname]) return overrides[parsed.pathname]();
    const data = parsed.pathname.includes("presets") ? [{
      preset_id: "older", key: "older", label: "Older preset", status: "active",
      input_schema_count: 2, input_slots_count: 1,
      ...(parsed.pathname.endsWith("summary") ? {} : { prompt_template: "Heavy prompt", input_schema_json: [{ key: "name" }] }),
    }] : ["/media/models", "/prompt-recipes", "/media/system-prompts", "/media/enhancement-configs", "/media/queue/policies"].includes(parsed.pathname) ? []
      : parsed.pathname === "/media/credits" ? { available_credits: 17 }
      : parsed.pathname === "/media/assets" ? { items: [{ asset_id: "asset-1", project_id: "project A" }], next_cursor: "next" }
      : { items: [] };
    return Response.json(data);
  }));
  return paths;
}

describe("Studio initial snapshot", () => {
  it("returns required project-scoped data with summaries and no unrelated reads", async () => {
    const paths = api();
    const snapshot = await getStudioSnapshot({ projectId: "project A" });
    expect(paths).toHaveLength(14);
    expect(paths).toEqual([
      "/health", "/media/credits", "/media/pricing", "/media/models", "/media/presets/summary",
      "/media/system-prompts", "/media/enhancement-configs", "/media/queue/settings", "/media/queue/policies",
      "/media/projects?status=all", "/media/batches?limit=8&offset=0&project_id=project%20A",
      "/media/jobs?limit=8&project_id=project%20A", "/media/assets?limit=18&compact=true&cursor_mode=asset_id&project_id=project%20A",
      "/media/assets/latest?project_id=project%20A",
    ]);
    expect(snapshot.credits.data.balance.available_credits).toBe(17);
    expect(snapshot.presets.data.presets[0]).toMatchObject({ preset_id: "older", input_schema_count: 2, input_slots_count: 1 });
    expect(snapshot.presets.data.presets[0]).not.toHaveProperty("prompt_template");
    expect(snapshot.presets.data.presets[0]).not.toHaveProperty("input_schema_json");
    expect(snapshot.assets.data).toMatchObject({ limit: 18, offset: 0, has_more: true, next_offset: 1 });
    expect(snapshot.assets.data.assets[0].project_id).toBe("project A");
    expect(decodeStudioGalleryCursor(
      snapshot.assets.data.next_cursor!,
      new URLSearchParams({ compact: "true", cursor_mode: "asset_id", project_id: "project A" }),
      "summary",
    )).toEqual({ cursor: "next", offset: 1 });
  });

  it("preserves the shared dashboard loader and full preset contract", async () => {
    const paths = api();
    const snapshot = await getMediaDashboardSnapshot();
    expect(paths).toHaveLength(19);
    expect(paths).toEqual([
      "/health", "/media/credits", "/media/pricing", "/media/external-llm-usage/summary", "/media/external-llm-usage?limit=20",
      "/media/models", "/media/presets", "/prompt-recipes?status=all", "/media/system-prompts", "/media/enhancement-configs",
      "/media/prompt-recipe-drafting-config", "/media/assistant-config", "/media/queue/settings", "/media/queue/policies",
      "/media/projects?status=all", "/media/batches?limit=8&offset=0", "/media/jobs?limit=8",
      "/media/assets?limit=18&compact=true&cursor_mode=asset_id", "/media/assets/latest",
    ]);
    expect(paths).toContain("/media/presets");
    expect(paths).toContain("/prompt-recipes?status=all");
    expect(paths).toContain("/media/external-llm-usage/summary");
    expect(snapshot.presets.data.presets[0].prompt_template).toBe("Heavy prompt");
  });

  it.each([
    ["Studio", getStudioSnapshot, 14],
    ["dashboard", getMediaDashboardSnapshot, 19],
  ] as const)("retains successful sections and defaults after partial %s failures", async (_name, load, count) => {
    const paths = api({
      "/media/credits": () => Response.json({ detail: "Credits unavailable" }, { status: 503 }),
      "/media/jobs": () => { throw new Error("Network unavailable"); },
      "/prompt-recipes": () => Response.json({ detail: "Recipes unavailable" }, { status: 500 }),
      "/media/queue/settings": () => Response.json(null),
    });
    const snapshot = await load();
    expect(paths).toHaveLength(count);
    expect(snapshot.credits).toEqual({ ok: false, data: { balance: { available_credits: null, remaining_credits: null } } });
    expect(snapshot.jobs).toEqual({ ok: false, data: { jobs: [] } });
    expect(snapshot.queueSettings).toEqual({ ok: true, data: { settings: null } });
    expect(snapshot.promptRecipes).toEqual({ ok: count === 14, data: { recipes: [] } });
    expect(snapshot.presets.ok).toBe(true);
    expect(snapshot.presets.data.presets[0].preset_id).toBe("older");
    expect(snapshot.assets.ok).toBe(true);
    expect(snapshot.assets.data.assets[0].asset_id).toBe("asset-1");
  });
});
