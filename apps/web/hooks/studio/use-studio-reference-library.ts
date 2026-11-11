"use client";

import { useCallback, useRef, useState } from "react";

import type { StudioAttachmentReplacement } from "@/hooks/studio/use-studio-attachments";
import type {
  AttachmentRecord,
  ComposerStatusMessage,
} from "@/lib/media-studio-contract";
import type {
  OrderedImageInput,
  PresetSlotState,
  StudioComposerSlot,
  StructuredPresetImageSlot,
  StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import type { MediaReference } from "@/lib/types";

export type ReferenceLibraryTarget =
  | { type: "browse"; title: string }
  | {
      type: "attachment";
      title: string;
      role?: "first_frame" | "last_frame" | "reference" | null;
      allowedKinds?: AttachmentRecord["kind"][];
      replacement?: StudioAttachmentReplacement;
    }
  | {
      type: "standard-slot";
      title: string;
      slotIndex: number;
      label: string;
      allowedKinds?: AttachmentRecord["kind"][];
    }
  | { type: "preset-slot"; title: string; slotKey: string };

const libraryKindByAttachmentKind = {
  images: "image",
  videos: "video",
  audios: "audio",
} as const;

export function studioReferenceLibraryKind(target: ReferenceLibraryTarget) {
  const kind =
    target.type === "attachment" ? target.allowedKinds?.[0] : undefined;
  return kind ? libraryKindByAttachmentKind[kind] : "image";
}

function recordReferenceUse(referenceId: string) {
  // Usage history is best effort; a failed request must not prevent staging.
  return fetch(`/api/control/reference-media/${referenceId}/use`, {
    method: "POST",
    credentials: "same-origin",
  });
}

function consumeTarget(
  target: ReferenceLibraryTarget | null,
  consumed: ReferenceLibraryTarget | null,
) {
  return target === consumed ? null : target;
}

function seedanceLibraryTarget(
  start: AttachmentRecord | null,
  end: AttachmentRecord | null,
  mode: string,
): ReferenceLibraryTarget {
  if (!start) {
    return {
      type: "attachment",
      title: "Pick a reusable image for the Seedance start frame.",
      role: "first_frame",
      allowedKinds: ["images"],
    };
  }
  if (mode === "first_last_frames" && !end) {
    return {
      type: "attachment",
      title: "Pick a reusable image for the Seedance end frame.",
      role: "last_frame",
      allowedKinds: ["images"],
    };
  }
  return {
    type: "attachment",
    title: "Pick a reusable image for Seedance reference guidance.",
    role: "reference",
    allowedKinds: ["images"],
  };
}

function contextualStandardImageSlot(
  enabled: boolean,
  slots: StudioComposerSlot[],
) {
  if (!enabled) return null;
  return (
    slots.find(({ kind, filled }) => kind === "image" && !filled) ??
    slots.find(({ kind }) => kind === "image")
  );
}

function composerReferenceTitle(role: AttachmentRecord["role"]) {
  if (!role || role === "reference")
    return "Pick a reusable reference from your library.";
  return `Pick a reusable image for the ${role === "first_frame" ? "start" : "end"} frame.`;
}

type AddReferenceMediaOptions = StudioAttachmentReplacement & {
  role?: "first_frame" | "last_frame" | "reference";
  allowedKinds?: AttachmentRecord["kind"][];
  insertImageIndex?: number;
  successMessage?: string;
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
  orderedImageInputs: OrderedImageInput[];
  dedicatedImageReferenceRailActive: boolean;
  setOpenPicker: (value: null) => void;
  setFormMessage: (message: ComposerStatusMessage | null) => void;
  assignPresetSlotReference: (
    slotKey: string,
    reference: MediaReference,
  ) => void;
  addReferenceMediaAsAttachment: (
    reference: MediaReference,
    options?: AddReferenceMediaOptions,
  ) => void;
  orderedImageReplacement: (
    slot: OrderedImageInput,
  ) => StudioAttachmentReplacement;
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
  orderedImageInputs,
  dedicatedImageReferenceRailActive,
  setOpenPicker,
  setFormMessage,
  assignPresetSlotReference,
  addReferenceMediaAsAttachment,
  orderedImageReplacement,
}: UseStudioReferenceLibraryOptions) {
  const [selectedReferencePreview, setSelectedReferencePreview] =
    useState<StudioReferencePreview | null>(null);
  const referenceLibraryReturnFocus = useRef<HTMLElement | null>(null);
  const consumedTarget = useRef<ReferenceLibraryTarget | null>(null);
  const [referenceLibraryTarget, setReferenceLibraryTarget] =
    useState<ReferenceLibraryTarget | null>(null);

  const openReferencePreview = useCallback(
    (preview: StudioReferencePreview | null) => {
      if (!preview?.url) {
        return;
      }
      setSelectedReferencePreview(preview);
    },
    [],
  );

  const openReferenceLibrary = useCallback(
    (
      target: ReferenceLibraryTarget,
      returnFocusTo: HTMLElement | null = null,
    ) => {
      referenceLibraryReturnFocus.current = returnFocusTo;
      setOpenPicker(null);
      setReferenceLibraryTarget(target);
    },
    [setOpenPicker],
  );

  function openComposerReferenceLibrary(
    kind: AttachmentRecord["kind"],
    role: AttachmentRecord["role"] = "reference",
    returnFocusTo?: HTMLElement | null,
    replacement?: StudioAttachmentReplacement,
  ) {
    openReferenceLibrary(
      {
        type: "attachment",
        title: replacement
          ? "Choose a replacement from your reference library."
          : composerReferenceTitle(role),
        role,
        allowedKinds: [kind],
        replacement,
      },
      returnFocusTo,
    );
  }

  const openPresetSlotReferenceLibrary = useCallback(
    (slot: StructuredPresetImageSlot, returnFocusTo?: HTMLElement) =>
      openReferenceLibrary(
        {
          type: "preset-slot",
          title: `Pick a reusable image for ${slot.label}.`,
          slotKey: slot.key,
        },
        returnFocusTo,
      ),
    [openReferenceLibrary],
  );

  const openStandardSlotReferenceLibrary = useCallback(
    (slot: StudioComposerSlot, returnFocusTo?: HTMLElement) =>
      openReferenceLibrary(
        {
          type: "standard-slot",
          title:
            slot.role === "end_frame"
              ? "Pick a reusable image for the end frame."
              : slot.role === "start_frame"
                ? "Pick a reusable image for the start frame."
                : "Pick a reusable image for this input.",
          slotIndex: slot.slotIndex,
          label: slot.label,
          allowedKinds: ["images"],
        },
        returnFocusTo,
      ),
    [openReferenceLibrary],
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
          return (
            !slotState?.assetId && !slotState?.referenceId && !slotState?.file
          );
        }) ?? structuredPresetImageSlots[0];
      openPresetSlotReferenceLibrary(targetSlot);
      return;
    }
    if (seedanceComposer) {
      openReferenceLibrary(
        seedanceLibraryTarget(
          seedanceFirstFrameAttachment,
          seedanceLastFrameAttachment,
          effectiveSeedanceMode,
        ),
      );
      return;
    }
    const standardSlot = contextualStandardImageSlot(
      standardComposerUsesExplicitSlots,
      standardComposerSlots,
    );
    if (standardSlot) {
      openStandardSlotReferenceLibrary(standardSlot);
      return;
    }
    openReferenceLibrary({
      type: "attachment",
      title: "Pick a reusable image from your reference library.",
      role: dedicatedImageReferenceRailActive ? "reference" : undefined,
      allowedKinds: ["images"],
    });
  }, [
    canOpenReferenceLibrary,
    dedicatedImageReferenceRailActive,
    effectiveSeedanceMode,
    openPresetSlotReferenceLibrary,
    openReferenceLibrary,
    openStandardSlotReferenceLibrary,
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
    (reference: MediaReference) => {
      const target = consumeTarget(
        referenceLibraryTarget,
        consumedTarget.current,
      );
      if (!target) return;
      consumedTarget.current = target;
      setReferenceLibraryTarget(null);
      recordReferenceUse(reference.reference_id).catch(() => {});
      if (target.type === "browse") {
        setFormMessage({
          tone: "warning",
          text: "This model cannot use image references. Switch to a model with image inputs to stage a library image.",
        });
        return;
      }
      if (target.type === "preset-slot") {
        assignPresetSlotReference(target.slotKey, reference);
        setFormMessage({
          tone: "healthy",
          text: "Reference image loaded into the preset slot.",
        });
        return;
      }
      if (target.type === "standard-slot") {
        if (target.slotIndex > orderedImageInputs.length) {
          setFormMessage({
            tone: "warning",
            text: "Fill the earlier image slot first.",
          });
          return;
        }
        const input = orderedImageInputs[target.slotIndex];
        addReferenceMediaAsAttachment(reference, {
          allowedKinds: target.allowedKinds,
          ...(input
            ? orderedImageReplacement(input)
            : { insertImageIndex: target.slotIndex }),
          successMessage: `Reference image loaded into ${target.label}.`,
        });
        return;
      }
      addReferenceMediaAsAttachment(reference, {
        role: target.role ?? undefined,
        allowedKinds: target.allowedKinds,
        ...target.replacement,
      });
    },
    [
      addReferenceMediaAsAttachment,
      assignPresetSlotReference,
      orderedImageInputs,
      orderedImageReplacement,
      referenceLibraryTarget,
      setFormMessage,
    ],
  );

  return {
    selectedReferencePreview,
    referenceLibraryTarget,
    referenceLibraryReturnFocus,
    setSelectedReferencePreview,
    setReferenceLibraryTarget,
    openReferencePreview,
    openContextualReferenceLibrary,
    openComposerReferenceLibrary,
    openPresetSlotReferenceLibrary,
    openStandardSlotReferenceLibrary,
    handleReferenceLibrarySelect,
  };
}
