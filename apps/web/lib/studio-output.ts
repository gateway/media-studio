import { studioOptionChoices } from "@/lib/studio-options";

const groupLabels = { image: "Image", gif: "GIF", svg: "SVG" } as const;
const formatGroups: Record<string, keyof typeof groupLabels> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "gif",
  svg: "svg",
};

export function studioOutputGroups(entries: Array<[string, Record<string, unknown>]>) {
  const schema = entries.find(([key]) => key === "output_format")?.[1];
  const formats = schema ? studioOptionChoices(schema, schema.default).map(String) : [];
  if (formats.some((format) => !Object.hasOwn(formatGroups, format))) return [];
  return Object.entries(groupLabels).flatMap(([key, label]) => {
    const supported = formats.filter((format) => formatGroups[format] === key);
    return supported.length ? [{ key, label, formats: supported }] : [];
  });
}

export function studioOutputSelection(
  entries: Array<[string, Record<string, unknown>]>,
  options: Record<string, unknown>,
) {
  const groups = studioOutputGroups(entries);
  const group = groups.find(({ formats }) => formats.includes(String(options.output_format)));
  return {
    group,
    grouped: groups.length > 1,
    action: group?.key === "image" ? "image" : group?.label,
    loopLabel: group?.key === "gif" ? studioGifLoopLabel(options) : null,
  };
}

export function studioStillFormat(values: Record<string, unknown>) {
  const format = values.output_format;
  return formatGroups[String(format)] === "image" ? format : values.studio_still_format;
}

function studioGifLoopLabel(options: Record<string, unknown>) {
  const frames = Number(options.frame_count);
  const milliseconds = Number(options.frame_duration_ms);
  const duration = frames * milliseconds / 1000;
  return Number.isFinite(duration) && duration > 0 ? `${duration} s per loop` : null;
}
