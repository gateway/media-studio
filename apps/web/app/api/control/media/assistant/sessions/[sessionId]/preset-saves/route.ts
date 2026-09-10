import { NextResponse } from "next/server";

import type { AssistantArtifactSaveResponse } from "@/components/graph-studio/types";
import { buildControlApiHeaders, CONTROL_API_BASE_URL, sendControlApiJson } from "@/lib/control-api";
import { createPresetThumbnailFromAsset } from "@/lib/preset-thumbnail-from-asset";
import { isRecord } from "@/lib/utils";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const response = await fetch(`${CONTROL_API_BASE_URL}/media/assistant/sessions/${encodeURIComponent(sessionId)}/preset-saves`, {
    method: "POST",
    headers: buildControlApiHeaders("admin", { "content-type": "application/json" }),
    body: JSON.stringify(await request.json()),
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) return NextResponse.json(body, { status: response.status });
  const saved = body as AssistantArtifactSaveResponse;
  const summary = saved.assistant_session.summary_json ?? {};
  const proposal = isRecord(summary.kernel_preset_proposal) ? summary.kernel_preset_proposal : {};
  const quality = isRecord(summary.kernel_preset_quality) ? summary.kernel_preset_quality : {};
  const evidence = isRecord(summary.kernel_preset_run_evidence) ? summary.kernel_preset_run_evidence : {};
  const assetId = typeof quality.output_asset_id === "string" ? quality.output_asset_id : "";
  const hasThumbnail = Boolean(saved.record.thumbnail_path || saved.record.thumbnail_url);
  if (hasThumbnail || proposal.save_mode !== "verified" || !assetId) return NextResponse.json(saved);
  if (saved.assistant_session.assistant_session_id !== sessionId
    || evidence.assistant_session_id !== sessionId
    || !Array.isArray(evidence.output_asset_ids) || !evidence.output_asset_ids.includes(assetId)
    || !isRecord(proposal.draft)) {
    const warning = "Media Preset saved, but its approved thumbnail could not be verified.";
    return NextResponse.json({ ...saved, message: warning, warning });
  }
  try {
    const thumbnail = await createPresetThumbnailFromAsset(assetId, String(saved.record.label ?? ""));
    if (!thumbnail.ok) throw new Error(thumbnail.error);
    const updated = await sendControlApiJson<Record<string, unknown>>(`/media/presets/${encodeURIComponent(String(saved.record.preset_id))}`, {
      method: "PATCH",
      payload: { ...proposal.draft, thumbnail_path: thumbnail.thumbnail_path, thumbnail_url: thumbnail.thumbnail_url },
      authMode: "admin",
    });
    if (!updated.ok || !updated.data) throw new Error(updated.error ?? "Unable to save the thumbnail.");
    return NextResponse.json({ ...saved, record: updated.data });
  } catch {
    const warning = "Media Preset saved, but its thumbnail could not be saved. Open the preset editor to add the image.";
    return NextResponse.json({ ...saved, message: warning, warning });
  }
}
