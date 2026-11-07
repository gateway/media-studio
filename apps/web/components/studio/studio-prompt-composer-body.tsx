"use client";

import { Image as ImageIcon, Layers, Sparkles } from "lucide-react";

import { StudioComposerOptionToggle } from "@/components/studio/studio-composer-controls";
import type { MultiShotParseResult } from "@/lib/studio-options";

import { cn } from "@/lib/utils";

export type StudioPromptReferenceChoice = {
  id: string;
  label: string;
  visualUrl: string | null;
};

type StudioPromptComposerBodyProps<Choice extends StudioPromptReferenceChoice> =
  {
    promptInputRef: React.RefObject<HTMLTextAreaElement | null>;
    prompt: string;
    multiShotsEnabled: boolean;
    multiShot?: {
      script: MultiShotParseResult;
      error: string | null;
      duration: unknown;
      onToggle: () => void;
    };
    promptReferencePickerOpen: boolean;
    promptReferenceChoices: Choice[];
    promptReferenceActiveIndex: number;
    enhanceEnabledForModel: boolean;
    enhanceConfiguredForModel: boolean;
    enhanceHasSavedSystemPrompt: boolean;
    onPromptChange: (prompt: string) => void;
    onPromptFocusChange: (focused: boolean) => void;
    onPromptReferenceDismissedChange: (dismissed: boolean) => void;
    onPromptCursorSync: (target: HTMLTextAreaElement | null) => void;
    onPromptReferenceActiveIndexChange: (
      updater: (current: number) => number,
    ) => void;
    onApplyPromptReferenceChoice: (choice: Choice | null) => void;
    onOpenEnhanceDialog: () => void;
    onOpenEnhancementSetup: () => void;
  };

export function StudioPromptComposerBody<
  Choice extends StudioPromptReferenceChoice,
>({
  promptInputRef,
  prompt,
  multiShotsEnabled,
  multiShot,
  promptReferencePickerOpen,
  promptReferenceChoices,
  promptReferenceActiveIndex,
  enhanceEnabledForModel,
  enhanceConfiguredForModel,
  enhanceHasSavedSystemPrompt,
  onPromptChange,
  onPromptFocusChange,
  onPromptReferenceDismissedChange,
  onPromptCursorSync,
  onPromptReferenceActiveIndexChange,
  onApplyPromptReferenceChoice,
  onOpenEnhanceDialog,
  onOpenEnhancementSetup,
}: StudioPromptComposerBodyProps<Choice>) {
  return (
    <div className="studio-prompt-body">
      <StudioMultiShotToggle enabled={multiShotsEnabled} control={multiShot} />
      <div className="relative">
        <label className="block">
          <span
            className={multiShotsEnabled ? "sr-only" : "studio-prompt-label"}
          >
            Prompt
          </span>
          <textarea
            data-testid="studio-prompt-input"
            ref={promptInputRef}
            value={prompt}
            onChange={(event) => {
              onPromptChange(event.target.value);
              onPromptReferenceDismissedChange(false);
              onPromptCursorSync(event.currentTarget);
            }}
            onFocus={(event) => {
              onPromptFocusChange(true);
              onPromptReferenceDismissedChange(false);
              onPromptCursorSync(event.currentTarget);
            }}
            onBlur={() => {
              onPromptFocusChange(false);
            }}
            onClick={(event) => onPromptCursorSync(event.currentTarget)}
            onKeyUp={(event) => onPromptCursorSync(event.currentTarget)}
            onSelect={(event) => onPromptCursorSync(event.currentTarget)}
            onKeyDown={(event) => {
              if (
                !promptReferencePickerOpen ||
                !promptReferenceChoices.length
              ) {
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                onPromptReferenceActiveIndexChange(
                  (current) => (current + 1) % promptReferenceChoices.length,
                );
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                onPromptReferenceActiveIndexChange((current) =>
                  current === 0
                    ? promptReferenceChoices.length - 1
                    : current - 1,
                );
                return;
              }
              if (["Enter", "Tab"].includes(event.key)) {
                event.preventDefault();
                onApplyPromptReferenceChoice(
                  promptReferenceChoices[promptReferenceActiveIndex] ?? null,
                );
                return;
              }
              if (event.key === "Escape") {
                onPromptReferenceDismissedChange(true);
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer?.files?.length) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              if (event.dataTransfer?.files?.length) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            placeholder={
              multiShotsEnabled
                ? "3 | Wide shot of the skyline\n2 | Hero steps into frame on the rooftop"
                : "Describe the scene you imagine"
            }
            className={cn("scrollbar-none studio-prompt-textarea")}
          />
        </label>
        {promptReferencePickerOpen ? (
          <div className="studio-prompt-reference-picker">
            <div className="studio-prompt-reference-options">
              {promptReferenceChoices.map((choice, index) => (
                <button
                  key={choice.id}
                  type="button"
                  data-testid={`studio-prompt-reference-option-${index + 1}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => onApplyPromptReferenceChoice(choice)}
                  className={cn(
                    "studio-prompt-reference-option",
                    promptReferenceActiveIndex === index
                      ? "studio-prompt-reference-option-active"
                      : "",
                  )}
                >
                  <span
                    className="studio-prompt-reference-thumb"
                    style={
                      choice.visualUrl
                        ? { backgroundImage: `url("${choice.visualUrl}")` }
                        : undefined
                    }
                  >
                    {!choice.visualUrl ? (
                      <span className="studio-prompt-reference-thumb-empty">
                        <ImageIcon className="size-4" />
                      </span>
                    ) : null}
                  </span>
                  <span className="studio-prompt-reference-label">
                    {choice.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <StudioPromptEnhanceAction
          enhanceEnabledForModel={enhanceEnabledForModel}
          enhanceConfiguredForModel={enhanceConfiguredForModel}
          enhanceHasSavedSystemPrompt={enhanceHasSavedSystemPrompt}
          onOpenEnhanceDialog={onOpenEnhanceDialog}
          onOpenEnhancementSetup={onOpenEnhancementSetup}
        />
      </div>
      <StudioMultiShotStatus enabled={multiShotsEnabled} control={multiShot} />
    </div>
  );
}

type MultiShotControl =
  StudioPromptComposerBodyProps<StudioPromptReferenceChoice>["multiShot"];

function StudioMultiShotToggle({
  enabled,
  control,
}: {
  enabled: boolean;
  control: MultiShotControl;
}) {
  if (!control) return null;
  return (
    <StudioComposerOptionToggle
      label="Multi-shot"
      icon={Layers}
      checked={enabled}
      onToggle={control.onToggle}
      showState={false}
    />
  );
}

function StudioMultiShotStatus({
  enabled,
  control,
}: {
  enabled: boolean;
  control: MultiShotControl;
}) {
  if (!enabled || !control) return null;
  const { script, error, duration } = control;
  return (
    <div
      className="studio-multi-shot-status"
      role="status"
      data-invalid={Boolean(error)}
    >
      <Layers aria-hidden="true" />
      <span>
        {error ??
          `${script.shots.length} shot${script.shots.length === 1 ? "" : "s"} · ${script.totalDuration} / ${String(duration)} seconds`}
      </span>
    </div>
  );
}

function StudioPromptEnhanceAction({
  enhanceEnabledForModel,
  enhanceConfiguredForModel,
  enhanceHasSavedSystemPrompt,
  onOpenEnhanceDialog,
  onOpenEnhancementSetup,
}: Pick<
  StudioPromptComposerBodyProps<StudioPromptReferenceChoice>,
  | "enhanceEnabledForModel"
  | "enhanceConfiguredForModel"
  | "enhanceHasSavedSystemPrompt"
  | "onOpenEnhanceDialog"
  | "onOpenEnhancementSetup"
>) {
  return enhanceEnabledForModel ? (
    enhanceConfiguredForModel ? (
      <button
        type="button"
        data-testid="studio-open-enhance-dialog"
        onClick={onOpenEnhanceDialog}
        aria-label={
          enhanceHasSavedSystemPrompt
            ? "Open enhance dialog"
            : "Enhance unavailable until a model prompt is saved"
        }
        title={
          enhanceHasSavedSystemPrompt
            ? "Open enhance dialog"
            : "Save an enhancement system prompt in Models"
        }
        disabled={!enhanceHasSavedSystemPrompt}
        className={cn(
          "studio-prompt-enhance-button",
          enhanceHasSavedSystemPrompt
            ? "studio-prompt-enhance-button-active"
            : "studio-prompt-enhance-button-disabled",
        )}
      >
        <Sparkles className="size-4" />
      </button>
    ) : (
      <button
        type="button"
        data-testid="studio-open-enhance-setup"
        onClick={onOpenEnhancementSetup}
        className="studio-prompt-enhance-setup-button"
      >
        Set up
      </button>
    )
  ) : null;
}
