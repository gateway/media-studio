import { isRecord } from "./utils";

function matchingOriginalPath(payload: unknown, thumbnailPath: string) {
  if (!isRecord(payload) || !Array.isArray(payload.outputs)) return null;
  const output = payload.outputs.find(
    (item: unknown) =>
      isRecord(item) &&
      item.kind === "image" &&
      item.thumb_path === thumbnailPath,
  );
  if (!isRecord(output) || typeof output.original_path !== "string")
    return null;
  return /^original\/[a-z0-9_-]+\.(?:png|jpe?g|webp|avif|gif)$/i.test(
    output.original_path,
  )
    ? output.original_path
    : null;
}

/** Read the existing run manifest and match its exact output; never guess an original. */
export async function resolvePresetPreviewOriginal(src: string) {
  const match = src.match(
    /^(\/api\/control\/files\/outputs\/\d{4}-\d{2}-\d{2}\/[a-z0-9_-]+)\/(thumb\/[a-z0-9_-]+\.(?:webp|png|jpe?g|avif))$/i,
  );
  if (!match) return null;
  try {
    const response = await fetch(`${match[1]}/run.json`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const original = matchingOriginalPath(await response.json(), match[2]);
    return original ? `${match[1]}/${original}?inline=1` : null;
  } catch {
    return null;
  }
}
