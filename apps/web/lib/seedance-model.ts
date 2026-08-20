export function isSeedanceModel(modelKey: string | null | undefined) {
  const normalized = String(modelKey ?? "").trim().toLowerCase().replaceAll("_", "-");
  return normalized === "seedance-2.5" || normalized === "seedance-2.0" || normalized.startsWith("seedance-2.0-");
}
