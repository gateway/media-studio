import { redirect } from "next/navigation";

export default async function LegacyNewMediaPresetPage({
  searchParams,
}: {
  searchParams?: Promise<{ model?: string; returnTo?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const params = new URLSearchParams();
  if (resolvedSearchParams.model) {
    params.set("model", resolvedSearchParams.model);
  }
  if (resolvedSearchParams.returnTo) {
    params.set("returnTo", resolvedSearchParams.returnTo);
  }
  const query = params.toString();
  redirect(`/presets/new${query ? `?${query}` : ""}`);
}
