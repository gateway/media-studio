import { redirect } from "next/navigation";

export default async function LegacyNewMediaPresetPage({
  searchParams,
}: {
  searchParams?: Promise<{ model?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const model = resolvedSearchParams.model ? `?model=${encodeURIComponent(resolvedSearchParams.model)}` : "";
  redirect(`/presets/new${model}`);
}
