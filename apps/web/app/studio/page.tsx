import type { Viewport } from "next";
import { MediaStudio } from "@/components/media-studio";
import { getStudioSnapshot } from "@/lib/control-api";
import { INITIAL_ASSET_PAGE_SIZE } from "@/lib/media-studio-contract";

export const viewport: Viewport = { interactiveWidget: "resizes-content" };

export default async function MediaStudioPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const selectedProjectId =
    typeof resolvedSearchParams?.project === "string"
      ? resolvedSearchParams.project
      : null;
  const snapshot = await getStudioSnapshot({ projectId: selectedProjectId });
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
      queueSettings={snapshot.queueSettings.data?.settings ?? null}
      queuePolicies={snapshot.queuePolicies.data?.policies ?? []}
      projects={snapshot.projects.data?.projects ?? []}
      batches={snapshot.batches.data?.batches ?? []}
      jobs={snapshot.jobs.data?.jobs ?? []}
      assets={snapshot.assets.data?.assets ?? []}
      initialAssetLimit={snapshot.assets.data?.limit ?? INITIAL_ASSET_PAGE_SIZE}
      initialAssetOffset={snapshot.assets.data?.offset ?? 0}
      initialAssetsHasMore={snapshot.assets.data?.has_more ?? false}
      initialAssetsNextOffset={snapshot.assets.data?.next_offset ?? null}
      initialAssetsNextCursor={snapshot.assets.data?.next_cursor ?? null}
      latestAsset={snapshot.latestAsset.data?.asset ?? null}
      remainingCredits={availableCredits}
      pricingSnapshot={snapshot.pricing.data?.snapshot ?? null}
      initialSelectedAssetId={
        typeof resolvedSearchParams?.asset === "string"
          ? resolvedSearchParams.asset
          : null
      }
      initialSelectedProjectId={selectedProjectId}
      immersive
      closeHref="/jobs"
    />
  );
}
