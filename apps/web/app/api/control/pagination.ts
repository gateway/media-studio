export function boundedIntegerParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
