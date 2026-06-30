export const MEDIA_PRESET_CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "portrait", label: "Portraits" },
  { value: "product", label: "Products" },
  { value: "character", label: "Characters" },
  { value: "style", label: "Styles" },
  { value: "layout", label: "Layouts" },
  { value: "restoration", label: "Restoration" },
  { value: "video", label: "Video" },
  { value: "utility", label: "Utility" },
] as const;

export type MediaPresetCategory = (typeof MEDIA_PRESET_CATEGORY_OPTIONS)[number]["value"];

export function normalizeMediaPresetCategory(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return normalized || "general";
}

export function mediaPresetCategoryLabel(value: unknown): string {
  const normalized = normalizeMediaPresetCategory(value);
  return MEDIA_PRESET_CATEGORY_OPTIONS.find((option) => option.value === normalized)?.label ?? "General";
}
