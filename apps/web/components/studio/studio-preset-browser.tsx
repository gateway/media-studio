"use client";

import {
  Box,
  ChevronDown,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Play,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { useMediaPresetPages } from "@/hooks/use-media-preset-pages";
import { MediaBrowserItem } from "@/components/media/media-browser-item";
import { StudioImageLightbox } from "./studio-image-lightbox";
import { resolvePresetPreviewOriginal } from "@/lib/preset-preview";
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
  composerPresetPicker?: ReactNode;
  navigation?: (actions: ReactNode) => ReactNode;
  returnFocusFallback?: RefObject<HTMLElement | null>;
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
  composerPresetPicker,
  navigation,
  returnFocusFallback,
  onClose,
  onSelectPreset,
}: StudioPresetBrowserProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [showModelPresets, setShowModelPresets] = useState(false);
  const [previewItem, setPreviewItem] = useState<{
    src: string;
    label: string;
    fallbackSrc?: string;
  } | null>(null);
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

  async function previewPreset(src: string, label: string) {
    setPreviewItem({ src, label });
    const original = await resolvePresetPreviewOriginal(src);
    if (original)
      setPreviewItem((current) =>
        current?.src === src
          ? { ...current, src: original, fallbackSrc: src }
          : current,
      );
  }

  const browserActions = (
    <PresetBrowserActions
      composerPresetPicker={composerPresetPicker}
      onClose={onClose}
      onCreate={() =>
        router.push(
          `/presets/new?returnTo=${encodeURIComponent(studioReturnToHref)}`,
        )
      }
      onShowModelPresets={() => setShowModelPresets(true)}
    />
  );
  return (
    <>
      <StudioBrowserOverlay
        testId="studio-preset-browser"
        zIndexClassName="z-[118]"
        onClose={onClose}
        suspended={previewItem != null}
        title="Media Presets"
        returnFocusFallback={returnFocusFallback}
        layout="presets"
        navigation={navigation?.(browserActions)}
        actions={browserActions}
      >
        <PresetBrowserToolbar
          query={query}
          onQueryChange={setQuery}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          categoryPickerOpen={categoryPickerOpen}
          onCategoryPickerOpenChange={setCategoryPickerOpen}
          visibleCount={visiblePresets.length}
          totalPresets={totalPresets}
          showModelPresets={showModelPresets}
          composerPresetPicker={composerPresetPicker}
        />
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
              {visiblePresets.map((preset) => (
                <PresetBrowserCard
                  key={preset.preset_id}
                  preset={preset}
                  models={models}
                  selectingPresetId={selectingPresetId}
                  onPreview={(src) => {
                    previewPreset(src, preset.label).catch((error: unknown) =>
                      setSelectionError(String(error)),
                    );
                  }}
                  onSelect={(item) => {
                    selectPreset(item).catch((error: unknown) =>
                      setSelectionError(String(error)),
                    );
                  }}
                  onEdit={() =>
                    router.push(
                      `/presets/${preset.preset_id}?returnTo=${encodeURIComponent(studioReturnToHref)}`,
                    )
                  }
                />
              ))}
            </StudioBrowserGrid>
            {nextOffset != null ? (
              <StudioBrowserLoadSentinel
                onLoadMore={loadMorePresets}
                disabled={loading}
                loading={loadingMore}
                label="Loading more presets..."
                actionLabel="Load more presets"
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
      {previewItem ? (
        <StudioImageLightbox
          src={previewItem.src}
          fallbackSrc={previewItem.fallbackSrc}
          alt={previewItem.label}
          closeLabel="Close preset image preview"
          onClose={() => setPreviewItem(null)}
        />
      ) : null}
    </>
  );
}

function PresetBrowserActions({
  composerPresetPicker,
  onClose,
  onCreate,
  onShowModelPresets,
}: {
  composerPresetPicker?: ReactNode;
  onClose: () => void;
  onCreate: () => void;
  onShowModelPresets: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <PillSelect
        pickerId="studio-preset-actions"
        menuAlign="end"
        icon={MoreHorizontal}
        iconOnly
        label="Preset actions"
        appearance="admin"
        open={actionsOpen}
        onToggle={() => setActionsOpen((open) => !open)}
        onClose={() => setActionsOpen(false)}
        choices={[
          { value: "new", label: "New preset" },
          ...(composerPresetPicker
            ? [{ value: "model", label: "Presets for this model" }]
            : []),
        ]}
        onSelect={(value) => {
          if (value === "model") onShowModelPresets();
          else onCreate();
        }}
      />
      <IconButton
        icon={X}
        onClick={onClose}
        appearance="admin"
        quiet
        aria-label="Close preset browser"
      />
    </div>
  );
}

function PresetBrowserCard({
  preset,
  models,
  selectingPresetId,
  onSelect,
  onEdit,
  onPreview,
}: {
  preset: PresetBrowserItem;
  models: MediaModelSummary[];
  selectingPresetId: string | null;
  onSelect: (preset: PresetBrowserItem) => void;
  onEdit: () => void;
  onPreview: (src: string) => void;
}) {
  const modelScope = studioPresetSupportedModels(preset as MediaPreset, models)
    .map(
      (modelKey) =>
        models.find((model) => model.key === modelKey)?.label ??
        prettifyModelLabel(modelKey),
    )
    .join(" · ");
  const thumb = presetBrowserThumbnailVisual(preset);
  const selecting = selectingPresetId === (preset.preset_id ?? preset.key);
  const apply = () => {
    onSelect(preset);
  };
  return (
    <MediaBrowserItem
      key={preset.preset_id}
      testId={`studio-preset-browser-card-${preset.preset_id}`}
      label={preset.label}
      previewUrl={thumb}
      previewLabel={`Preview ${preset.label}`}
      previewTitle={thumb ? "Preview full image" : "No preview image available"}
      onPreview={() => {
        if (thumb) onPreview(thumb);
      }}
      disabled={selectingPresetId != null || !thumb}
      layout="editorial"
      description={preset.description ?? "No description added yet."}
      metadata={
        <details className="studio-preset-models">
          <summary tabIndex={0}>
            <Box aria-hidden="true" className="size-4" />
            Compatible models
            <ChevronDown aria-hidden="true" className="size-3" />
          </summary>
          <div>{modelScope || "No model scope"}</div>
          <div>{presetInputSummary(preset)}</div>
          <div>{mediaPresetCategoryLabel(preset.category)}</div>
        </details>
      }
      actions={
        <>
          <Button
            onClick={onEdit}
            appearance="admin"
            size="compact"
            variant="ghost"
            aria-label={`Edit ${preset.label}`}
            title="Edit preset"
          >
            <Pencil className="size-4" /> Edit
          </Button>
          <Button
            data-testid={`studio-preset-browser-item-${preset.preset_id}`}
            onClick={apply}
            disabled={selectingPresetId != null}
            appearance="admin"
            size="compact"
            variant="primary"
            aria-label={selecting ? "Loading preset" : "Use preset"}
            title="Use preset"
          >
            {selecting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            Use preset
          </Button>
        </>
      }
    />
  );
}

function PresetBrowserToolbar({
  query,
  onQueryChange,
  selectedCategory,
  onCategoryChange,
  categoryPickerOpen,
  onCategoryPickerOpenChange,
  visibleCount,
  totalPresets,
  showModelPresets,
  composerPresetPicker,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  categoryPickerOpen: boolean;
  onCategoryPickerOpenChange: (open: boolean) => void;
  visibleCount: number;
  totalPresets: number;
  showModelPresets: boolean;
  composerPresetPicker?: ReactNode;
}) {
  const categoryChoices = [
    { value: "all", label: "All categories" },
    ...MEDIA_PRESET_CATEGORY_OPTIONS,
  ];
  const categoryPickerLabel =
    categoryChoices.find((category) => category.value === selectedCategory)
      ?.label ?? "All categories";

  return (
    <StudioBrowserToolbar
      countLabel={
        selectedCategory === "all"
          ? `Showing ${visibleCount} of ${totalPresets}`
          : `${mediaPresetCategoryLabel(selectedCategory)} · ${visibleCount} of ${totalPresets}`
      }
    >
      <div className="studio-browser-filters">
        <span className="studio-preset-browser-title" aria-hidden="true">
          Media Presets
        </span>
        <StudioBrowserSearchInput
          id="studio-preset-browser-search"
          label="Search presets"
          value={query}
          onChange={onQueryChange}
          placeholder="Search"
        />
        <div className="studio-preset-category-controls">
          <div
            className="studio-browser-category-shortcuts"
            aria-label="Preset categories"
          >
            {categoryChoices
              .filter((category) =>
                ["all", "portrait", "product", "character"].includes(
                  category.value,
                ),
              )
              .map((category) => (
                <Button
                  key={category.value}
                  appearance="admin"
                  variant={
                    selectedCategory === category.value ? "primary" : "subtle"
                  }
                  size="compact"
                  aria-label={`Filter presets: ${category.label}`}
                  aria-pressed={selectedCategory === category.value}
                  onClick={() => onCategoryChange(category.value)}
                >
                  {category.value === "all" ? "All" : category.label}
                </Button>
              ))}
          </div>
          <PillSelect
            pickerId="studio-preset-category"
            menuAlign="end"
            open={categoryPickerOpen}
            onToggle={() => onCategoryPickerOpenChange(!categoryPickerOpen)}
            onClose={() => onCategoryPickerOpenChange(false)}
            appearance="admin"
            iconOnly
            label={categoryPickerLabel}
            choices={categoryChoices}
            selectedValue={selectedCategory}
            menuTitle="Preset category"
            onSelect={(value) => {
              onCategoryChange(value);
              onCategoryPickerOpenChange(false);
            }}
          />
        </div>
        {showModelPresets ? composerPresetPicker : null}
      </div>
    </StudioBrowserToolbar>
  );
}
