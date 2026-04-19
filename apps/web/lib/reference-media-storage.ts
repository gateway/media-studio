import "server-only";

import { getReferenceMedia, importReferenceMediaFile } from "@/lib/control-api";
import type { MediaReference } from "@/lib/types";

export async function registerReferenceMediaFile(file: File) {
  const result = await importReferenceMediaFile(file);
  if (!result.ok || !result.data?.item) {
    throw new Error(result.error ?? "Unable to register reference media.");
  }
  return result.data.item;
}

export async function resolveReferenceMedia(referenceId: string): Promise<MediaReference | null> {
  const result = await getReferenceMedia(referenceId);
  return result.data?.item ?? null;
}
