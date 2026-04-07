import { MediaStudio } from "@/components/media-studio";
import { getMediaDashboardSnapshot } from "@/lib/control-api";
import { INITIAL_ASSET_PAGE_SIZE } from "@/lib/media-studio-contract";

export default async function MediaStudioPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const snapshot = await getMediaDashboardSnapshot();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const balance = snapshot.credits.data?.balance;
  const availableCredits =
    typeof balance?.available_credits === "number"
      ? balance.available_credits
      : typeof balance?.remaining_credits === "number"
        ? balance.remaining_credits
        : null;

  return (
    <MediaStudio
      apiHealthy={snapshot.status.ok}
      models={snapshot.models.data?.models ?? []}
      presets={snapshot.presets.data?.presets ?? []}
      prompts={snapshot.prompts.data?.prompts ?? []}
      enhancementConfigs={snapshot.enhancementConfigs.data?.configs ?? []}
      llmPresets={snapshot.llmPresets.data?.presets ?? []}
      queueSettings={snapshot.queueSettings.data?.settings ?? null}
      queuePolicies={snapshot.queuePolicies.data?.policies ?? []}
      batches={snapshot.batches.data?.batches ?? []}
      jobs={snapshot.jobs.data?.jobs ?? []}
      assets={snapshot.assets.data?.assets ?? []}
      initialAssetLimit={snapshot.assets.data?.limit ?? INITIAL_ASSET_PAGE_SIZE}
      initialAssetOffset={snapshot.assets.data?.offset ?? 0}
      initialAssetsHasMore={snapshot.assets.data?.has_more ?? false}
      initialAssetsNextOffset={snapshot.assets.data?.next_offset ?? null}
      latestAsset={snapshot.latestAsset.data?.asset ?? null}
      remainingCredits={availableCredits}
      pricingSnapshot={snapshot.pricing.data?.snapshot ?? null}
      initialSelectedAssetId={
        typeof resolvedSearchParams?.asset === "string" ? resolvedSearchParams.asset : null
      }
      immersive
      closeHref="/jobs"
    />
  );
}
