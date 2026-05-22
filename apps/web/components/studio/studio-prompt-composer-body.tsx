"use client";

import { Image as ImageIcon, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export type StudioPromptReferenceChoice = {
  id: string;
  label: string;
  visualUrl: string | null;
};

type StudioPromptComposerBodyProps<Choice extends StudioPromptReferenceChoice> = {
  promptInputRef: React.RefObject<HTMLTextAreaElement | null>;
  prompt: string;
  multiShotsEnabled: boolean;
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
  onPromptReferenceActiveIndexChange: (updater: (current: number) => number) => void;
  onApplyPromptReferenceChoice: (choice: Choice | null) => void;
  onOpenEnhanceDialog: () => void;
  onOpenEnhancementSetup: () => void;
};

export function StudioPromptComposerBody<Choice extends StudioPromptReferenceChoice>({
  promptInputRef,
  prompt,
  multiShotsEnabled,
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
    <div className="relative">
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
          if (!promptReferencePickerOpen || !promptReferenceChoices.length) {
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            onPromptReferenceActiveIndexChange((current) => (current + 1) % promptReferenceChoices.length);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            onPromptReferenceActiveIndexChange((current) =>
              current === 0 ? promptReferenceChoices.length - 1 : current - 1,
            );
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            onApplyPromptReferenceChoice(promptReferenceChoices[promptReferenceActiveIndex] ?? null);
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
        className={cn(
          "scrollbar-none w-full resize-none rounded-[26px] border border-white/8 bg-white/[0.04] px-4 py-[18px] text-[0.86rem] leading-6 text-white outline-none placeholder:text-white/38 focus:border-[rgba(216,141,67,0.3)]",
          "min-h-[146px] md:min-h-[136px]",
        )}
      />
      {promptReferencePickerOpen ? (
        <div className="absolute bottom-3 left-3 z-20 w-[min(19rem,calc(100%-4.5rem))] rounded-[18px] border border-white/10 bg-[rgba(17,20,19,0.96)] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <div className="grid gap-1">
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
                  "flex items-center gap-3 rounded-[12px] px-2 py-2 text-left text-[0.8rem] font-medium text-white/82 transition hover:bg-white/[0.08] hover:text-white",
                  promptReferenceActiveIndex === index ? "bg-white/[0.08] text-white" : "",
                )}
              >
                <span
                  className="inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-[10px] border border-white/10 bg-white/[0.05] bg-cover bg-center bg-no-repeat"
                  style={choice.visualUrl ? { backgroundImage: `url("${choice.visualUrl}")` } : undefined}
                >
                  {!choice.visualUrl ? (
                    <span className="flex h-full w-full items-center justify-center text-white/48">
                      <ImageIcon className="size-4" />
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{choice.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {enhanceEnabledForModel ? (
        enhanceConfiguredForModel ? (
          <button
            type="button"
            data-testid="studio-open-enhance-dialog"
            onClick={onOpenEnhanceDialog}
            aria-label={enhanceHasSavedSystemPrompt ? "Open enhance dialog" : "Enhance unavailable until a model prompt is saved"}
            title={enhanceHasSavedSystemPrompt ? "Open enhance dialog" : "Save an enhancement system prompt in Models"}
            disabled={!enhanceHasSavedSystemPrompt}
            className={cn(
              "absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full border transition",
              enhanceHasSavedSystemPrompt
                ? "border-white/10 bg-white/[0.06] text-white/72 hover:border-[rgba(216,141,67,0.32)] hover:bg-[rgba(216,141,67,0.14)] hover:text-white"
                : "cursor-not-allowed border-white/8 bg-white/[0.03] text-white/28",
            )}
          >
            <Sparkles className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            data-testid="studio-open-enhance-setup"
            onClick={onOpenEnhancementSetup}
            className="absolute bottom-3 right-3 inline-flex h-9 items-center justify-center rounded-full border border-[rgba(216,141,67,0.22)] bg-[rgba(216,141,67,0.12)] px-3 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#ffd7af] transition hover:border-[rgba(216,141,67,0.34)] hover:text-white"
          >
            Set up
          </button>
        )
      ) : null}
    </div>
  );
}
