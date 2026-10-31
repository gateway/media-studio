"use client";

import { ListFilter, LogIn, LoaderCircle, Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { useMediaPresetPages } from "@/hooks/use-media-preset-pages";
import { MediaBrowserItem } from "@/components/media/media-browser-item";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PillSelect } from "@/components/ui/pill-select";
import { EmptyState, CalloutPanel } from "@/components/ui/surface-primitives";
import {
  StudioBrowserGrid,
  StudioBrowserLoadSentinel,
  StudioBrowserOverlay,
  StudioBrowserSearchInput,
  StudioBrowserToolbar,
} from "./studio-browser-surface";
import {
  MEDIA_PRESET_CATEGORY_OPTIONS,
  mediaPresetCategoryLabel,
  normalizeMediaPresetCategory,
} from "@/lib/media-preset-categories";
import {
  presetThumbnailVisual,
  prettifyModelLabel,
  studioPresetSupportedModels,
} from "@/lib/media-studio-helpers";
import type {
  MediaModelSummary,
  MediaPreset,
  MediaPresetSummaryItem,
} from "@/lib/types";

type StudioPresetBrowserProps = {
  presets: MediaPreset[];
  models: MediaModelSummary[];
  returnToHref?: string | null;
  onClose: () => void;
  onSelectPreset: (preset: MediaPreset) => void;
};

const PRESET_BROWSER_PAGE_SIZE = 60;

type PresetBrowserItem = MediaPreset | MediaPresetSummaryItem;

function presetInputSummary(preset: PresetBrowserItem) {
  const textFieldCount =
    "input_schema_count" in preset &&
    typeof preset.input_schema_count === "number"
      ? preset.input_schema_count
      : ((preset as MediaPreset).input_schema_json?.length ?? 0);
  const imageSlotCount =
    "input_slots_count" in preset &&
    typeof preset.input_slots_count === "number"
      ? preset.input_slots_count
      : ((preset as MediaPreset).input_slots_json?.length ?? 0);
  return `${textFieldCount} text field${textFieldCount === 1 ? "" : "s"} · ${imageSlotCount} image slot${imageSlotCount === 1 ? "" : "s"}`;
}

function presetMatchesQuery(preset: PresetBrowserItem, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [preset.label, preset.key, preset.description]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function presetMatchesCategory(preset: PresetBrowserItem, category: string) {
  const normalized = normalizeMediaPresetCategory(category);
  return (
    normalized === "all" ||
    normalizeMediaPresetCategory(preset.category) === normalized
  );
}

function presetBrowserThumbnailVisual(preset: PresetBrowserItem) {
  if ("prompt_template" in preset) {
    return presetThumbnailVisual(preset);
  }
  return preset.thumbnail_url ?? null;
}

async function fetchPresetDetail(presetId: string): Promise<MediaPreset> {
  const response = await fetch(
    `/api/control/media-presets/${encodeURIComponent(presetId)}`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error("Unable to load preset details.");
  const payload = (await response.json()) as {
    ok?: boolean;
    preset?: MediaPreset | null;
    error?: string;
  };
  if (payload.ok === false || !payload.preset)
    throw new Error(payload.error ?? "Unable to load preset details.");
  return payload.preset;
}

export function StudioPresetBrowser({
  presets,
  models,
  returnToHref = null,
  onClose,
  onSelectPreset,
}: StudioPresetBrowserProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const deferredCategory = useDeferredValue(selectedCategory);
  const {
    page: remotePage,
    loading,
    loadingMore,
    error: pageError,
    loadMore: loadMorePresets,
    retry,
  } = useMediaPresetPages({
    query: deferredQuery,
    category: deferredCategory,
    view: "summary",
    refreshKey: presets,
  });
  const [selectingPresetId, setSelectingPresetId] = useState<string | null>(
    null,
  );
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const loadError = pageError ?? selectionError;

  useEffect(() => {
    setSelectionError(null);
  }, [deferredCategory, deferredQuery]);
  const studioReturnToHref =
    returnToHref &&
    returnToHref.startsWith("/") &&
    !returnToHref.startsWith("//")
      ? returnToHref
      : "/studio";
  const fallbackPresets = useMemo(
    () =>
      presets
        .filter((preset) => presetMatchesQuery(preset, deferredQuery))
        .filter((preset) => presetMatchesCategory(preset, deferredCategory))
        .slice(0, PRESET_BROWSER_PAGE_SIZE),
    [deferredCategory, deferredQuery, presets],
  );
  const visiblePresets = remotePage ? remotePage.presets : fallbackPresets;
  const totalPresets = remotePage?.total ?? presets.length;
  const nextOffset = pageError ? null : (remotePage?.next_offset ?? null);

  const categoryChoices = useMemo(
    () => [
      { value: "all", label: "All categories" },
      ...MEDIA_PRESET_CATEGORY_OPTIONS,
    ],
    [],
  );
  const categoryPickerLabel =
    categoryChoices.find((category) => category.value === selectedCategory)
      ?.label ?? "All categories";

  async function selectPreset(preset: PresetBrowserItem) {
    const presetId = preset.preset_id ?? preset.key;
    if (!presetId || selectingPresetId) return;
    setSelectingPresetId(presetId);
    setSelectionError(null);
    try {
      const detail = await fetchPresetDetail(presetId);
      onSelectPreset(detail);
    } catch (error) {
      setSelectionError(
        error instanceof Error
          ? error.message
          : "Unable to load preset details.",
      );
    } finally {
      setSelectingPresetId(null);
    }
  }

  return (
    <StudioBrowserOverlay
      testId="studio-preset-browser"
      zIndexClassName="z-[118]"
      onClose={onClose}
      title="Studio presets"
      description="Choose a preset to load its model and composer setup."
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() =>
              router.push(
                `/presets/new?returnTo=${encodeURIComponent(studioReturnToHref)}`,
              )
            }
            variant="primary"
            appearance="admin"
          >
            <Plus className="size-4" /> New preset
          </Button>
          <IconButton
            icon={X}
            onClick={onClose}
            appearance="admin"
            quiet
            aria-label="Close preset browser"
          />
        </div>
      }
    >
      <StudioBrowserToolbar
        countLabel={
          selectedCategory === "all"
            ? `Showing ${visiblePresets.length} of ${totalPresets}`
            : `${mediaPresetCategoryLabel(selectedCategory)} · ${visiblePresets.length} of ${totalPresets}`
        }
      >
        <div className="studio-browser-filters">
          <StudioBrowserSearchInput
            id="studio-preset-browser-search"
            label="Search presets"
            value={query}
            onChange={setQuery}
            placeholder="Search presets by name, key, or description..."
          />
          <PillSelect
            pickerId="studio-preset-category"
            open={categoryPickerOpen}
            onToggle={() => setCategoryPickerOpen((value) => !value)}
            onClose={() => setCategoryPickerOpen(false)}
            appearance="admin"
            icon={ListFilter}
            label={categoryPickerLabel}
            choices={categoryChoices}
            selectedValue={selectedCategory}
            menuTitle="Preset category"
            onSelect={(value) => {
              setSelectedCategory(value);
              setCategoryPickerOpen(false);
            }}
          />
        </div>
      </StudioBrowserToolbar>
      {loadError ? (
        <CalloutPanel tone="warning" className="mb-4">
          {loadError}
          {pageError && !remotePage
            ? " Showing the first matching local presets instead."
            : null}
          {pageError ? (
            <Button
              appearance="admin"
              type="button"
              variant="subtle"
              size="compact"
              onClick={retry}
            >
              Retry loading presets
            </Button>
          ) : null}
        </CalloutPanel>
      ) : null}
      {visiblePresets.length ? (
        <>
          <StudioBrowserGrid>
            {visiblePresets.map((preset) => {
              const modelScope = studioPresetSupportedModels(
                preset as MediaPreset,
                models,
              )
                .map(
                  (modelKey) =>
                    models.find((model) => model.key === modelKey)?.label ??
                    prettifyModelLabel(modelKey),
                )
                .join(" · ");
              const thumb = presetBrowserThumbnailVisual(preset);
              const selecting =
                selectingPresetId === (preset.preset_id ?? preset.key);
              const apply = () => {
                selectPreset(preset).catch((error: unknown) =>
                  setSelectionError(String(error)),
                );
              };
              return (
                <MediaBrowserItem
                  key={preset.preset_id}
                  testId={`studio-preset-browser-card-${preset.preset_id}`}
                  label={preset.label}
                  previewUrl={thumb}
                  previewLabel={`Apply ${preset.label}`}
                  onPreview={apply}
                  disabled={selectingPresetId != null}
                  category={mediaPresetCategoryLabel(preset.category)}
                  description={
                    preset.description ?? "No description added yet."
                  }
                  metadata={
                    <>
                      <div title={modelScope}>
                        {modelScope || "No model scope"}
                      </div>
                      <div>{presetInputSummary(preset)}</div>
                    </>
                  }
                  actions={
                    <>
                      <IconButton
                        data-testid={`studio-preset-browser-item-${preset.preset_id}`}
                        icon={selecting ? LoaderCircle : LogIn}
                        iconClassName={selecting ? "animate-spin" : undefined}
                        onClick={apply}
                        disabled={selectingPresetId != null}
                        appearance="admin"
                        size="compact"
                        quiet
                        tone="primary"
                        aria-label={selecting ? "Loading preset" : "Use preset"}
                        title="Use preset"
                      />
                      <IconButton
                        icon={Pencil}
                        onClick={() =>
                          router.push(
                            `/presets/${preset.preset_id}?returnTo=${encodeURIComponent(studioReturnToHref)}`,
                          )
                        }
                        appearance="admin"
                        size="compact"
                        quiet
                        tone="primary"
                        aria-label={`Edit ${preset.label}`}
                        title="Edit preset"
                      />
                    </>
                  }
                />
              );
            })}
          </StudioBrowserGrid>
          {nextOffset != null ? (
            <StudioBrowserLoadSentinel
              onLoadMore={loadMorePresets}
              disabled={loading}
              loading={loadingMore}
              label="Loading more presets..."
            />
          ) : null}
        </>
      ) : (
        <EmptyState
          appearance="admin"
          title={
            loading
              ? "Loading presets..."
              : "No active Studio presets are available yet."
          }
          description={
            query.trim()
              ? "Try a different preset search."
              : "Add one in the Presets admin route first."
          }
          className="text-left"
        />
      )}
    </StudioBrowserOverlay>
  );
}
