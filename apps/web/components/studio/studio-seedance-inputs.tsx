"use client";

import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

export function StudioSeedanceInputs({
  effectiveMode,
  frames,
  references,
}: {
  effectiveMode: string;
  frames: ReactNode;
  references: ReactNode;
}) {
  const id = useId();
  const [selection, setSelection] = useState<{
    pattern: string;
    view: "frames" | "references";
  } | null>(null);
  // Follow restored/staged input roles until the user chooses a presentation.
  // Switching this view never mutates the attachment-owned generation mode.
  const view =
    selection?.pattern === effectiveMode
      ? selection.view
      : effectiveMode === "multimodal_reference"
        ? "references"
        : "frames";
  const views = ["frames", "references"] as const;
  return (
    <section className="studio-seedance-inputs" aria-label="Seedance inputs">
      <div
        className="studio-seedance-mode-tabs"
        role="tablist"
        aria-label="Input view"
      >
        {views.map((mode, index) => (
          <Button
            key={mode}
            appearance="admin"
            variant="ghost"
            role="tab"
            id={`${id}-${mode}-tab`}
            aria-controls={`${id}-${mode}`}
            aria-selected={view === mode}
            tabIndex={view === mode ? 0 : -1}
            onClick={() => setSelection({ pattern: effectiveMode, view: mode })}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? views[0]
                  : event.key === "End"
                    ? views[1]
                    : views[1 - index];
              setSelection({ pattern: effectiveMode, view: next });
              document.getElementById(`${id}-${next}-tab`)?.focus();
            }}
          >
            {mode === "frames" ? "Frames" : "References"}
          </Button>
        ))}
      </div>
      <p className="studio-seedance-input-hint">Choose frames or references</p>
      {views.map((mode) => (
        <div
          key={mode}
          id={`${id}-${mode}`}
          role="tabpanel"
          aria-labelledby={`${id}-${mode}-tab`}
          hidden={view !== mode}
        >
          {mode === "frames" ? frames : references}
        </div>
      ))}
    </section>
  );
}

export function seedanceComposerInputs({
  seedance,
  effectiveMode,
  ...inputs
}: {
  seedance: boolean;
  effectiveMode: string;
  referenceInputs: ReactNode;
  sourceAttachmentStrip: ReactNode;
  mobileInputsContent: ReactNode;
}) {
  if (!seedance) return inputs;
  return {
    referenceInputs: (
      <StudioSeedanceInputs
        effectiveMode={effectiveMode}
        frames={inputs.sourceAttachmentStrip}
        references={inputs.referenceInputs}
      />
    ),
    sourceAttachmentStrip: null,
    mobileInputsContent: null,
  };
}
