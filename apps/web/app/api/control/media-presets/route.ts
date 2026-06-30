import { NextResponse } from "next/server";

import { controlErrorResponse } from "@/app/api/control/responses";
import {
  getControlApiJson,
  postControlApiJson,
  mapPresetRecord,
  mapPresetSummaryRecord,
} from "@/lib/control-api";
import { boundedIntegerParam } from "../pagination";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = boundedIntegerParam(url.searchParams.get("limit"), 60, 1, 100);
  const offset = boundedIntegerParam(
    url.searchParams.get("offset"),
    0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const q = (url.searchParams.get("q") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();
  const status =
    (url.searchParams.get("status") ?? "active").trim() || "active";
  const view = url.searchParams.get("view");
  const mapPresetForView =
    view === "summary" ? mapPresetSummaryRecord : mapPresetRecord;
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    status,
  });
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  const result = await getControlApiJson<{
    items?: Record<string, unknown>[];
    total?: number;
    limit?: number;
    offset?: number;
    next_offset?: number | null;
  }>(`/media/presets/search?${params.toString()}`, "read");

  if (!result.ok || !result.data) {
    return controlErrorResponse(result.error, "Unable to load media presets.", 502);
  }

  return NextResponse.json({
    ok: true,
    presets: (result.data.items ?? []).map((preset) =>
      mapPresetForView(preset),
    ),
    total: Number(result.data.total ?? 0),
    limit: Number(result.data.limit ?? limit),
    offset: Number(result.data.offset ?? offset),
    next_offset: result.data.next_offset ?? null,
  });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await postControlApiJson<Record<string, unknown>>(
    "/media/presets",
    payload,
    "admin",
  );

  if (!result.ok || !result.data) {
    return controlErrorResponse(result.error, "Unable to create the media preset.", 502);
  }

  return NextResponse.json({ ok: true, preset: mapPresetRecord(result.data) });
}
