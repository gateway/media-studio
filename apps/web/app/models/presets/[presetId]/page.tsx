import { redirect } from "next/navigation";

export default async function LegacyEditMediaPresetPage({
  params,
}: {
  params: Promise<{ presetId: string }>;
}) {
  const resolvedParams = await params;
  redirect(`/presets/${encodeURIComponent(resolvedParams.presetId)}`);
}
