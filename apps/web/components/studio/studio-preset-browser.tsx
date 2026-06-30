"use client";

import { ListFilter, Pencil, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PillSelect } from "@/components/ui/pill-select";
import {
  EmptyState,
  MediaBrowserCard,
} from "@/components/ui/surface-primitives";
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
import { presetThumbnailVisual, prettifyModelLabel, studioPresetSupportedModels } from "@/lib/media-studio-helpers";
import type { MediaModelSummary, MediaPreset, MediaPresetSummaryItem } from "@/lib/types";

type StudioPresetBrowserProps = {
  presets: MediaPreset[];
  models: MediaModelSummary[];
  returnToHref?: string | null;
  onClose: () => void;
  onSelectPreset: (preset: MediaPreset) => void;
};

const PRESET_BROWSER_PAGE_SIZE = 60;

type PresetBrowserItem = MediaPreset | MediaPresetSummaryItem;

type PresetBrowserPage = {
  presets: PresetBrowserItem[];
  total: number;
  offset: number;
  next_offset: number | null;
};

function presetInputSummary(preset: PresetBrowserItem) {
  const textFieldCount =
    "input_schema_count" in preset && typeof preset.input_schema_count === "number"
      ? preset.input_schema_count
      : (preset as MediaPreset).input_schema_json?.length ?? 0;
  const imageSlotCount =
    "input_slots_count" in preset && typeof preset.input_slots_count === "number"
      ? preset.input_slots_count
      : (preset as MediaPreset).input_slots_json?.length ?? 0;
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
  return normalized === "all" || normalizeMediaPresetCategory(preset.category) === normalized;
}

function presetBrowserThumbnailVisual(preset: PresetBrowserItem) {
  if ("prompt_template" in preset) {
    return presetThumbnailVisual(preset);
  }
  return preset.thumbnail_url ?? null;
}

async function fetchPresetPage(query: string, category: string, offset: number): Promise<PresetBrowserPage> {
  const params = new URLSearchParams({
    limit: String(PRESET_BROWSER_PAGE_SIZE),
    offset: String(offset),
    status: "active",
    view: "summary",
  });
  if (query.trim()) params.set("q", query.trim());
  if (category !== "all") params.set("category", category);
  const response = await fetch(`/api/control/media-presets?${params.toString()}`);
  const payload = (await response.json().catch(() => ({}))) as PresetBrowserPage & { ok?: boolean; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Unable to load presets.");
  if (payload.ok === false) throw new Error(payload.error ?? "Unable to load presets.");
  return {
    presets: Array.isArray(payload.presets) ? payload.presets : [],
    total: Number(payload.total ?? 0),
    offset: Number(payload.offset ?? offset),
    next_offset: payload.next_offset ?? null,
  };
}

async function fetchPresetDetail(presetId: string): Promise<MediaPreset> {
  const response = await fetch(`/api/control/media-presets/${encodeURIComponent(presetId)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to load preset details.");
  const payload = (await response.json()) as { ok?: boolean; preset?: MediaPreset | null; error?: string };
  if (payload.ok === false || !payload.preset) throw new Error(payload.error ?? "Unable to load preset details.");
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
  const [remotePage, setRemotePage] = useState<PresetBrowserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectingPresetId, setSelectingPresetId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const studioReturnToHref =
    returnToHref && returnToHref.startsWith("/") && !returnToHref.startsWith("//")
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
  const visiblePresets = remotePage?.presets.length ? remotePage.presets : fallbackPresets;
  const totalPresets = remotePage?.total ?? presets.length;
  const nextOffset = loadError
    ? null
    : remotePage
    ? remotePage.next_offset
    : fallbackPresets.length < presets.length
      ? PRESET_BROWSER_PAGE_SIZE
      : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchPresetPage(deferredQuery, deferredCategory, 0)
      .then((page) => {
        if (!cancelled) setRemotePage(page);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRemotePage(null);
          setLoadError(error instanceof Error ? error.message : "Unable to load presets.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deferredCategory, deferredQuery]);

  const loadMorePresets = useCallback(async () => {
    if (nextOffset == null) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await fetchPresetPage(deferredQuery, deferredCategory, nextOffset);
      setRemotePage((current) => ({
        presets: [...(current?.presets ?? fallbackPresets), ...page.presets],
        total: page.total,
        offset: current?.offset ?? 0,
        next_offset: page.next_offset,
      }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load more presets.");
    } finally {
      setLoadingMore(false);
    }
  }, [deferredCategory, deferredQuery, fallbackPresets, nextOffset]);

  const categoryChoices = useMemo(
    () => [
      { value: "all", label: "All categories" },
      ...MEDIA_PRESET_CATEGORY_OPTIONS,
    ],
    [],
  );
  const categoryPickerLabel =
    categoryChoices.find((category) => category.value === selectedCategory)?.label ?? "All categories";

  async function selectPreset(preset: PresetBrowserItem) {
    const presetId = preset.preset_id ?? preset.key;
    if (!presetId || selectingPresetId) return;
    setSelectingPresetId(presetId);
    setLoadError(null);
    try {
      const detail = await fetchPresetDetail(presetId);
      onSelectPreset(detail);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load preset details.");
    } finally {
      setSelectingPresetId(null);
    }
  }

  useEffect(() => {
    if (nextOffset == null || loading || loadingMore || typeof IntersectionObserver === "undefined") return;
    const element = loadMoreRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMorePresets();
        }
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loadMorePresets, loading, loadingMore, nextOffset]);

  return (
    <StudioBrowserOverlay
      testId="studio-preset-browser"
      zIndexClassName="z-[118]"
      eyebrow="Studio Presets"
      title="Studio Presets"
      description="Pick a preset first, then Studio will load the right model and composer setup for you."
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => router.push(`/presets/new?returnTo=${encodeURIComponent(studioReturnToHref)}`)}
            variant="primary"
            size="compact"
            className="h-10 rounded-full px-4 text-[0.68rem]"
          >
            New Preset
          </Button>
          <IconButton
            icon={X}
            onClick={onClose}
            className="h-10 w-10"
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
        <div className="grid w-full gap-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] md:items-start">
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
              appearance="studio"
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
        </div>
      </StudioBrowserToolbar>
      {loadError ? (
        <div className="mb-4 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          {loadError} Showing the first matching local presets instead.
        </div>
      ) : null}
      {visiblePresets.length ? (
        <>
          <StudioBrowserGrid>
              {visiblePresets.map((preset) => {
                const modelScope = studioPresetSupportedModels(preset as MediaPreset, models)
                  .map((modelKey) => prettifyModelLabel(modelKey))
                  .join(", ");
                const thumb = presetBrowserThumbnailVisual(preset);
                return (
                  <MediaBrowserCard
                    key={preset.preset_id}
                    data-testid={`studio-preset-browser-card-${preset.preset_id}`}
                    appearance="studio"
                    interactive
                    className="shadow-[0_18px_40px_rgba(0,0,0,0.24)]"
                  >
                    <button
                      type="button"
                      onClick={() => void selectPreset(preset)}
                      className="media-browser-card-thumbnail group relative aspect-square text-left"
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={preset.label}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/58">
                          <Sparkles className="size-6" />
                        </div>
                      )}
                    </button>
                    <div className="media-browser-card-copy">
                      <div className="media-browser-card-title truncate">{preset.label}</div>
                      <div className="media-browser-card-description line-clamp-2 min-h-[2rem]">
                        {preset.description ?? "No description added yet."}
                      </div>
                    </div>
                    <div className="media-browser-card-meta">
                      {mediaPresetCategoryLabel(preset.category)} · Available for {modelScope || "No model scope"}
                    </div>
                    <div className="media-browser-card-meta">
                      {presetInputSummary(preset)}
                    </div>
                    <div className="media-browser-card-actions">
                      <Button
                        type="button"
                        data-testid={`studio-preset-browser-item-${preset.preset_id}`}
                        onClick={() => void selectPreset(preset)}
                        variant="primary"
                        size="compact"
                        disabled={selectingPresetId === (preset.preset_id ?? preset.key)}
                        className="h-8 min-w-0 rounded-full px-3 text-[0.62rem] tracking-[0.12em] text-[#172200]"
                      >
                        <Sparkles className="mr-1.5 size-3.5" />
                        {selectingPresetId === (preset.preset_id ?? preset.key) ? "Loading..." : "Use preset"}
                      </Button>
                      <IconButton
                        icon={Pencil}
                        onClick={() => router.push(`/presets/${preset.preset_id}?returnTo=${encodeURIComponent(studioReturnToHref)}`)}
                        className="h-8 w-8 rounded-full"
                        aria-label={`Edit ${preset.label}`}
                        title="Edit preset"
                      />
                    </div>
                  </MediaBrowserCard>
                );
              })}
          </StudioBrowserGrid>
          {nextOffset != null ? (
            <StudioBrowserLoadSentinel
              ref={loadMoreRef}
              loading={loadingMore}
              label="Loading more presets..."
            />
          ) : null}
        </>
      ) : (
        <EmptyState
          appearance="studio"
          eyebrow="Studio Presets"
          title={loading ? "Loading presets..." : "No active Studio presets are available yet."}
          description={query.trim() ? "Try a different preset search." : "Add one in the Presets admin route first."}
          className="text-left"
        />
      )}
    </StudioBrowserOverlay>
  );
}
