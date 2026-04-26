import { useEffect, useMemo, useRef, useState } from "react";

import {
  mediaDisplayUrl,
  mediaPlaybackUrl,
  mediaThumbnailUrl,
  mediaVariantUrl,
  normalizeStructuredPresetImageSlots,
  normalizeStructuredPresetTextFields,
  structuredPresetSlotPreviewUrl,
} from "@/lib/media-studio-helpers";
import {
  findMediaAssetById,
  mediaAssetPrompt,
  structuredPresetInputValues,
  structuredPresetInputValuesFromAsset,
  structuredPresetSlotValues,
  structuredPresetSlotValuesFromAsset,
} from "@/lib/studio-gallery";
import type { MediaAsset, MediaJob, MediaPreset } from "@/lib/types";

type UseStudioSelectionParams = {
  initialSelectedAssetId: string | null;
  localAssets: MediaAsset[];
  favoriteAssets: MediaAsset[] | null;
  localJobs: MediaJob[];
  presets: MediaPreset[];
  onHydratedJob?: (job: MediaJob) => void;
};

type UseStudioSelectionResult = {
  refs: {
    lightboxVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  };
  state: {
    selectedAssetId: string | number | null;
    selectedAssetHydratedJob: MediaJob | null;
    selectedMediaLightboxOpen: boolean;
    mobileInspectorPromptOpen: boolean;
    mobileInspectorInfoOpen: boolean;
  };
  derived: {
    selectedAsset: MediaAsset | null;
    selectedAssetCachedJob: MediaJob | null;
    selectedAssetJob: MediaJob | null;
    selectedAssetPrompt: string | null;
    selectedAssetPreset: MediaPreset | null;
    selectedAssetPresetFields: ReturnType<typeof normalizeStructuredPresetTextFields>;
    selectedAssetPresetSlots: ReturnType<typeof normalizeStructuredPresetImageSlots>;
    selectedAssetPresetInputValues: Record<string, string>;
    selectedAssetPresetSlotValues: Record<string, unknown>;
    selectedAssetStructuredPresetActive: boolean;
    selectedAssetDisplayVisual: string | null;
    selectedAssetPlaybackVisual: string | null;
    selectedAssetLightboxVisual: string | null;
  };
  actions: {
    setSelectedAssetId: React.Dispatch<React.SetStateAction<string | number | null>>;
    setSelectedAssetHydratedJob: React.Dispatch<React.SetStateAction<MediaJob | null>>;
    setSelectedMediaLightboxOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setMobileInspectorPromptOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setMobileInspectorInfoOpen: React.Dispatch<React.SetStateAction<boolean>>;
    resetInspector: () => void;
    openSelectedMediaLightbox: () => void;
    closeSelectedMediaLightbox: () => Promise<void>;
  };
};

export function useStudioSelection({
  initialSelectedAssetId,
  localAssets,
  favoriteAssets,
  localJobs,
  presets,
  onHydratedJob,
}: UseStudioSelectionParams): UseStudioSelectionResult {
  const lightboxVideoRef = useRef<HTMLVideoElement | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | number | null>(initialSelectedAssetId);
  const [selectedAssetHydratedJob, setSelectedAssetHydratedJob] = useState<MediaJob | null>(null);
  const [selectedMediaLightboxOpen, setSelectedMediaLightboxOpen] = useState(false);
  const [mobileInspectorPromptOpen, setMobileInspectorPromptOpen] = useState(false);
  const [mobileInspectorInfoOpen, setMobileInspectorInfoOpen] = useState(false);
  const hydratedJobCallbackRef = useRef(onHydratedJob);
  const hydratedInitialSelectedAssetIdRef = useRef<string | null>(null);

  useEffect(() => {
    hydratedJobCallbackRef.current = onHydratedJob;
  }, [onHydratedJob]);

  const selectedAsset = findMediaAssetById(selectedAssetId, localAssets, favoriteAssets) ?? null;
  const selectedAssetCachedJob = useMemo(() => {
    if (!selectedAsset) {
      return null;
    }
    return (
      localJobs.find((job) => {
        if (selectedAsset.job_id && job.job_id === selectedAsset.job_id) {
          return true;
        }
        if (selectedAsset.provider_task_id && job.provider_task_id === selectedAsset.provider_task_id) {
          return true;
        }
        if (selectedAsset.run_id && job.artifact?.run_id === selectedAsset.run_id) {
          return true;
        }
        return false;
      }) ?? null
    );
  }, [localJobs, selectedAsset]);
  const selectedAssetJob =
    selectedAssetHydratedJob && selectedAssetHydratedJob.job_id === selectedAsset?.job_id
      ? selectedAssetHydratedJob
      : selectedAssetCachedJob;
  const selectedAssetPrompt = mediaAssetPrompt(selectedAsset, selectedAssetJob);
  const selectedAssetPreset = useMemo(
    () => presets.find((preset) => preset.key === selectedAsset?.preset_key) ?? null,
    [presets, selectedAsset?.preset_key],
  );
  const selectedAssetPresetFields = useMemo(
    () => normalizeStructuredPresetTextFields(selectedAssetPreset),
    [selectedAssetPreset],
  );
  const selectedAssetPresetSlots = useMemo(
    () => normalizeStructuredPresetImageSlots(selectedAssetPreset),
    [selectedAssetPreset],
  );
  const selectedAssetPresetInputValues = useMemo(() => {
    const fromJob = structuredPresetInputValues(selectedAssetJob);
    if (Object.keys(fromJob).length > 0) {
      return fromJob;
    }
    return structuredPresetInputValuesFromAsset(selectedAsset);
  }, [selectedAsset, selectedAssetJob]);
  const selectedAssetPresetSlotValues = useMemo(() => {
    const fromJob = structuredPresetSlotValues(selectedAssetJob);
    if (Object.keys(fromJob).length > 0) {
      return fromJob;
    }
    return structuredPresetSlotValuesFromAsset(selectedAsset);
  }, [selectedAsset, selectedAssetJob]);
  const selectedAssetStructuredPresetActive =
    Boolean(selectedAssetPreset) && (selectedAssetPresetFields.length > 0 || selectedAssetPresetSlots.length > 0);
  const selectedAssetDisplayVisual = mediaDisplayUrl(selectedAsset);
  const selectedAssetPlaybackVisual = mediaPlaybackUrl(selectedAsset);
  const selectedAssetLightboxVisual =
    (selectedAsset?.generation_kind === "video"
      ? selectedAssetPlaybackVisual ?? selectedAssetDisplayVisual
      : mediaVariantUrl(selectedAsset, "original") ??
        mediaVariantUrl(selectedAsset, "web") ??
        selectedAssetDisplayVisual) ?? null;

  useEffect(() => {
    if (!selectedAssetId) {
      setSelectedMediaLightboxOpen(false);
    }
  }, [selectedAssetId]);

  useEffect(() => {
    if (!initialSelectedAssetId) {
      hydratedInitialSelectedAssetIdRef.current = null;
      return;
    }
    const normalizedInitialAssetId = String(initialSelectedAssetId);
    if (hydratedInitialSelectedAssetIdRef.current === normalizedInitialAssetId) {
      return;
    }
    const matchedAsset = findMediaAssetById(initialSelectedAssetId, localAssets, favoriteAssets);
    if (matchedAsset) {
      setSelectedAssetId(matchedAsset.asset_id);
      hydratedInitialSelectedAssetIdRef.current = normalizedInitialAssetId;
    }
  }, [favoriteAssets, initialSelectedAssetId, localAssets]);

  useEffect(() => {
    if (!selectedMediaLightboxOpen || selectedAsset?.generation_kind !== "video") {
      return;
    }
    const video = lightboxVideoRef.current;
    if (!video) {
      return;
    }
    const timer = window.setTimeout(() => {
      void video.play().catch(() => undefined);
      const webkitVideo = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
      if (typeof video.requestFullscreen === "function") {
        void video.requestFullscreen().catch(() => {
          webkitVideo.webkitEnterFullscreen?.();
        });
        return;
      }
      webkitVideo.webkitEnterFullscreen?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedAsset?.asset_id, selectedAsset?.generation_kind, selectedMediaLightboxOpen]);

  useEffect(() => {
    if (!selectedAssetId) {
      setSelectedAssetHydratedJob(null);
      setMobileInspectorPromptOpen(false);
      setMobileInspectorInfoOpen(false);
      return;
    }
    setMobileInspectorPromptOpen(true);
    setMobileInspectorInfoOpen(false);
  }, [selectedAssetId]);

  useEffect(() => {
    if (!selectedAsset?.job_id) {
      setSelectedAssetHydratedJob(null);
      return;
    }
    setSelectedAssetHydratedJob(null);
    let cancelled = false;
    void fetch(`/api/control/media-jobs/${selectedAsset.job_id}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as { ok?: boolean; job?: MediaJob | null };
        if (!response.ok || !payload.ok || !payload.job || cancelled) {
          return;
        }
        setSelectedAssetHydratedJob(payload.job);
        hydratedJobCallbackRef.current?.(payload.job);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.asset_id, selectedAsset?.job_id]);

  function resetInspector() {
    setSelectedMediaLightboxOpen(false);
    setSelectedAssetId(null);
  }

  function openSelectedMediaLightbox() {
    if (!selectedAssetLightboxVisual) {
      return;
    }
    setSelectedMediaLightboxOpen(true);
  }

  async function closeSelectedMediaLightbox() {
    if (typeof document !== "undefined" && document.fullscreenElement && typeof document.exitFullscreen === "function") {
      try {
        await document.exitFullscreen();
      } catch {
        // ignore exit failures so the lightbox can still close
      }
    }
    setSelectedMediaLightboxOpen(false);
  }

  return {
    refs: {
      lightboxVideoRef,
    },
    state: {
      selectedAssetId,
      selectedAssetHydratedJob,
      selectedMediaLightboxOpen,
      mobileInspectorPromptOpen,
      mobileInspectorInfoOpen,
    },
    derived: {
      selectedAsset,
      selectedAssetCachedJob,
      selectedAssetJob,
      selectedAssetPrompt,
      selectedAssetPreset,
      selectedAssetPresetFields,
      selectedAssetPresetSlots,
      selectedAssetPresetInputValues,
      selectedAssetPresetSlotValues,
      selectedAssetStructuredPresetActive,
      selectedAssetDisplayVisual,
      selectedAssetPlaybackVisual,
      selectedAssetLightboxVisual,
    },
    actions: {
      setSelectedAssetId,
      setSelectedAssetHydratedJob,
      setSelectedMediaLightboxOpen,
      setMobileInspectorPromptOpen,
      setMobileInspectorInfoOpen,
      resetInspector,
      openSelectedMediaLightbox,
      closeSelectedMediaLightbox,
    },
  };
}
