"use client";

import { useCallback, useState } from "react";

import type { AttachmentRecord, ComposerStatusMessage } from "@/lib/media-studio-contract";
import type {
  PresetSlotState,
  StudioComposerSlot,
  StructuredPresetImageSlot,
  StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import type { MediaReference } from "@/lib/types";

export type ReferenceLibraryTarget =
  | { type: "browse"; title: string }
  | { type: "attachment"; title: string; role?: "first_frame" | "last_frame" | "reference" | null; allowedKinds?: AttachmentRecord["kind"][] }
  | { type: "standard-slot"; title: string; slotIndex: number; label: string; allowedKinds?: AttachmentRecord["kind"][] }
  | { type: "preset-slot"; title: string; slotKey: string };

type AddReferenceMediaOptions = {
  role?: "first_frame" | "last_frame" | "reference";
  allowedKinds?: AttachmentRecord["kind"][];
  insertImageIndex?: number;
  replaceImageIndex?: number;
};

type UseStudioReferenceLibraryOptions = {
  canOpenReferenceLibrary: boolean;
  structuredPresetActive: boolean;
  structuredPresetImageSlots: StructuredPresetImageSlot[];
  presetSlotStates: Record<string, PresetSlotState>;
  seedanceComposer: boolean;
  seedanceFirstFrameAttachment: AttachmentRecord | null;
  seedanceLastFrameAttachment: AttachmentRecord | null;
  effectiveSeedanceMode: string;
  standardComposerUsesExplicitSlots: boolean;
  standardComposerSlots: StudioComposerSlot[];
  orderedImageInputCount: number;
  dedicatedImageReferenceRailActive: boolean;
  setOpenPicker: (value: null) => void;
  setFormMessage: (message: ComposerStatusMessage | null) => void;
  assignPresetSlotReference: (slotKey: string, reference: MediaReference) => void;
  clearSourceAsset: () => void;
  addReferenceMediaAsAttachment: (reference: MediaReference, options?: AddReferenceMediaOptions) => void;
  orderedImageInputSourceAt: (slotIndex: number) => "asset" | "attachment" | "reference" | null;
};

export function useStudioReferenceLibrary({
  canOpenReferenceLibrary,
  structuredPresetActive,
  structuredPresetImageSlots,
  presetSlotStates,
  seedanceComposer,
  seedanceFirstFrameAttachment,
  seedanceLastFrameAttachment,
  effectiveSeedanceMode,
  standardComposerUsesExplicitSlots,
  standardComposerSlots,
  orderedImageInputCount,
  dedicatedImageReferenceRailActive,
  setOpenPicker,
  setFormMessage,
  assignPresetSlotReference,
  clearSourceAsset,
  addReferenceMediaAsAttachment,
  orderedImageInputSourceAt,
}: UseStudioReferenceLibraryOptions) {
  const [selectedReferencePreview, setSelectedReferencePreview] = useState<StudioReferencePreview | null>(null);
  const [referenceLibraryTarget, setReferenceLibraryTarget] = useState<ReferenceLibraryTarget | null>(null);

  const openReferencePreview = useCallback((preview: StudioReferencePreview | null) => {
    if (!preview?.url) {
      return;
    }
    setSelectedReferencePreview(preview);
  }, []);

  const openReferenceLibrary = useCallback(
    (target: ReferenceLibraryTarget) => {
      setOpenPicker(null);
      setReferenceLibraryTarget(target);
    },
    [setOpenPicker],
  );

  const openContextualReferenceLibrary = useCallback(() => {
    if (!canOpenReferenceLibrary) {
      openReferenceLibrary({
        type: "browse",
        title: "Reference Library",
      });
      return;
    }
    if (structuredPresetActive && structuredPresetImageSlots.length) {
      const targetSlot =
        structuredPresetImageSlots.find((slot) => {
          const slotState = presetSlotStates[slot.key];
          return !slotState?.assetId && !slotState?.referenceId && !slotState?.file;
        }) ?? structuredPresetImageSlots[0];
      openReferenceLibrary({
        type: "preset-slot",
        title: `Pick a reusable image for ${targetSlot.label}.`,
        slotKey: targetSlot.key,
      });
      return;
    }
    if (seedanceComposer) {
      if (!seedanceFirstFrameAttachment) {
        openReferenceLibrary({
          type: "attachment",
          title: "Pick a reusable image for the Seedance start frame.",
          role: "first_frame",
          allowedKinds: ["images"],
        });
        return;
      }
      if (effectiveSeedanceMode === "first_last_frames" && !seedanceLastFrameAttachment) {
        openReferenceLibrary({
          type: "attachment",
          title: "Pick a reusable image for the Seedance end frame.",
          role: "last_frame",
          allowedKinds: ["images"],
        });
        return;
      }
      openReferenceLibrary({
        type: "attachment",
        title: "Pick a reusable image for Seedance reference guidance.",
        role: "reference",
        allowedKinds: ["images"],
      });
      return;
    }
    const nextStandardImageSlot =
      standardComposerSlots.find((slot) => slot.kind === "image" && !slot.filled) ??
      standardComposerSlots.find((slot) => slot.kind === "image") ??
      null;
    if (standardComposerUsesExplicitSlots && nextStandardImageSlot) {
      openReferenceLibrary({
        type: "standard-slot",
        title:
          nextStandardImageSlot.role === "end_frame"
            ? "Pick a reusable image for the end frame."
            : nextStandardImageSlot.role === "start_frame"
              ? "Pick a reusable image for the start frame."
              : "Pick a reusable image for this input.",
        slotIndex: nextStandardImageSlot.slotIndex,
        label: nextStandardImageSlot.label,
        allowedKinds: ["images"],
      });
      return;
    }
    openReferenceLibrary({
      type: "attachment",
      title: dedicatedImageReferenceRailActive
        ? "Pick a reusable image reference for Nano Banana."
        : "Pick a reusable image from your reference library.",
      role: dedicatedImageReferenceRailActive ? "reference" : undefined,
      allowedKinds: ["images"],
    });
  }, [
    canOpenReferenceLibrary,
    dedicatedImageReferenceRailActive,
    effectiveSeedanceMode,
    openReferenceLibrary,
    presetSlotStates,
    seedanceComposer,
    seedanceFirstFrameAttachment,
    seedanceLastFrameAttachment,
    standardComposerSlots,
    standardComposerUsesExplicitSlots,
    structuredPresetActive,
    structuredPresetImageSlots,
  ]);

  const handleReferenceLibrarySelect = useCallback(
    async (reference: MediaReference) => {
      try {
        await fetch(`/api/control/reference-media/${reference.reference_id}/use`, {
          method: "POST",
          credentials: "same-origin",
        });
      } catch {
        // Helpful, not required for staging.
      }
      const target = referenceLibraryTarget;
      setReferenceLibraryTarget(null);
      if (!target) {
        return;
      }
      if (target.type === "browse") {
        setFormMessage({
          tone: "warning",
          text: "This model cannot use image references. Switch to a model with image inputs to stage a library image.",
        });
        return;
      }
      if (target.type === "preset-slot") {
        assignPresetSlotReference(target.slotKey, reference);
        setFormMessage({ tone: "healthy", text: "Reference image loaded into the preset slot." });
        return;
      }
      if (target.type === "standard-slot") {
        if (target.slotIndex > orderedImageInputCount) {
          setFormMessage({ tone: "warning", text: "Fill the earlier image slot first." });
          return;
        }
        if (orderedImageInputSourceAt(target.slotIndex) === "asset") {
          clearSourceAsset();
        }
        addReferenceMediaAsAttachment(reference, {
          allowedKinds: target.allowedKinds,
          insertImageIndex: Math.min(target.slotIndex, orderedImageInputCount),
          replaceImageIndex: target.slotIndex,
        });
        setFormMessage({ tone: "healthy", text: `Reference image loaded into ${target.label}.` });
        return;
      }
      addReferenceMediaAsAttachment(reference, {
        role: target.role ?? undefined,
        allowedKinds: target.allowedKinds,
      });
      setFormMessage({ tone: "healthy", text: "Reference image loaded from the library." });
    },
    [
      addReferenceMediaAsAttachment,
      assignPresetSlotReference,
      clearSourceAsset,
      orderedImageInputCount,
      orderedImageInputSourceAt,
      referenceLibraryTarget,
      setFormMessage,
    ],
  );

  return {
    selectedReferencePreview,
    referenceLibraryTarget,
    setSelectedReferencePreview,
    setReferenceLibraryTarget,
    openReferencePreview,
    openReferenceLibrary,
    openContextualReferenceLibrary,
    handleReferenceLibrarySelect,
  };
}
