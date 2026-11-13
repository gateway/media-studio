export function parseStudioAspectRatio(value: string, separator: ":" | ":x/") {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([:x/])\s*(\d+(?:\.\d+)?)$/i);
  if (!match || !separator.includes(match[2].toLowerCase())) return null;
  const width = Number(match[1]);
  const height = Number(match[3]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}
