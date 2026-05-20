"use client";

import { LoaderCircle, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type StudioEnhanceDialogProps = {
  open: boolean;
  previewVisual: string | null;
  userPrompt: string;
  enhancedPrompt: string | null;
  imageAnalysisText: string | null;
  currentModelLabel: string | null;
  currentPresetLabel: string | null;
  providerLabel: string;
  providerModelId: string | null;
  modeLabel: string;
  readinessLabel: string;
  imageAnalysisStatus: string;
  configuredForModel: boolean;
  hasSavedSystemPrompt: boolean;
  busy: boolean;
  error: string | null;
  warnings: string[];
  onClose: () => void;
  onRequestPreview: () => void;
  onOpenSetup: () => void;
  onUsePrompt: () => void;
};

export function StudioEnhanceDialog({
  open,
  previewVisual,
  userPrompt,
  enhancedPrompt,
  imageAnalysisText,
  currentModelLabel,
  currentPresetLabel,
  providerLabel,
  providerModelId,
  modeLabel,
  readinessLabel,
  imageAnalysisStatus,
  configuredForModel,
  hasSavedSystemPrompt,
  busy,
  error,
  warnings,
  onClose,
  onRequestPreview,
  onOpenSetup,
  onUsePrompt,
}: StudioEnhanceDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div data-testid="studio-enhance-dialog" className="fixed inset-0 z-[125] bg-[rgba(6,8,7,0.7)] backdrop-blur-md">
      <div className="absolute inset-0 p-3 md:p-6">
        <div className="grid h-full gap-4 rounded-[34px] border border-white/8 bg-[linear-gradient(180deg,rgba(16,20,18,0.96),rgba(10,13,12,0.96))] p-4 shadow-[0_40px_100px_rgba(0,0,0,0.5)] lg:grid-cols-[minmax(0,1fr)_320px] lg:p-6">
          <div className="grid min-h-0 gap-4 overflow-hidden rounded-[30px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%),linear-gradient(180deg,#111514,#181d1b)] p-4 lg:p-6">
            <div className="relative overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01)),radial-gradient(circle_at_top,rgba(216,141,67,0.12),transparent_36%),rgba(5,7,6,0.86)]">
              {previewVisual ? (
                <div className="flex min-h-[260px] items-center justify-center p-4 sm:min-h-[340px] sm:p-5">
                  <img
                    src={previewVisual}
                    alt="Enhancement reference"
                    className="max-h-[50vh] w-auto max-w-full rounded-[24px] object-contain shadow-[0_24px_70px_rgba(0,0,0,0.42)]"
                  />
                </div>
              ) : (
                <div className="flex min-h-[260px] items-center justify-center px-6 text-center text-sm text-white/56 sm:min-h-[340px]">
                  No image reference is staged for this enhancement preview.
                </div>
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">User prompt</div>
                <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/78">
                  {userPrompt || "No prompt entered yet."}
                </pre>
              </div>
              <div className="rounded-[22px] border border-[rgba(216,141,67,0.14)] bg-[rgba(216,141,67,0.05)] p-4">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[#ffd7af]">Enhanced prompt</div>
                <pre data-testid="studio-enhance-preview-text" className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/88">
                  {enhancedPrompt || (busy ? "Enhancing prompt..." : "Run enhance to preview the rewritten prompt.")}
                </pre>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4 xl:col-span-2">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">Image analysis</div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/76">
                  {imageAnalysisText
                    ? imageAnalysisText
                    : previewVisual
                      ? "No image analysis output is available for this preview yet."
                      : "No image reference is staged, so there is nothing to analyze."}
                </div>
              </div>
            </div>
          </div>

          <div className="grid auto-rows-max gap-4 overflow-y-auto rounded-[28px] bg-[rgba(255,255,255,0.04)] p-4 text-white lg:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/54">Enhance prompt</div>
                <div className="mt-1 text-base font-semibold text-white">{currentModelLabel ?? "Unknown model"}</div>
                <div className="mt-1 text-sm text-white/66">Preview the rewrite, then send it back to the composer.</div>
              </div>
              <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/24 text-white/78 transition hover:text-white">
                <X className="size-5" />
              </button>
            </div>

            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">Preview summary</div>
              <div className="mt-3 grid gap-3 text-sm leading-6 text-white/74">
                <div>
                  <span className="text-white/48">Model:</span> {currentModelLabel ?? "Unknown model"}
                </div>
                <div>
                  <span className="text-white/48">Enhancement provider:</span> {providerLabel}
                </div>
                <div>
                  <span className="text-white/48">Enhancement model:</span> {providerModelId ?? "Not selected"}
                </div>
                <div>
                  <span className="text-white/48">Enhancement mode:</span> {modeLabel}
                </div>
                <div>
                  <span className="text-white/48">Readiness:</span> {readinessLabel}
                </div>
                <div>
                  <span className="text-white/48">Preset:</span> {currentPresetLabel ?? "No preset selected"}
                </div>
                <div>
                  <span className="text-white/48">Image reference:</span> {previewVisual ? "Attached" : "None"}
                </div>
                <div>
                  <span className="text-white/48">Image analysis:</span> {imageAnalysisStatus}
                </div>
              </div>
            </div>

            {error ? (
              <div className="rounded-[20px] border border-[rgba(201,102,82,0.22)] bg-[rgba(201,102,82,0.08)] px-4 py-3 text-sm text-[#ffb5a6]">
                {error}
              </div>
            ) : null}
            {warnings.length ? (
              <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/72">
                {warnings.join(" ")}
              </div>
            ) : null}

            <div className="grid gap-3">
              {configuredForModel ? (
                <Button
                  type="button"
                  data-testid="studio-enhance-run-button"
                  onClick={onRequestPreview}
                  disabled={busy || !hasSavedSystemPrompt}
                  variant="primary"
                  className="h-auto w-full gap-3 rounded-[22px] px-5 py-4 text-[0.98rem] font-semibold text-[#162300] shadow-[0_18px_34px_rgba(156,204,33,0.22)]"
                >
                  {busy ? <LoaderCircle className="size-4.5 animate-spin" /> : <Sparkles className="size-4.5" />}
                  {busy ? "Enhancing..." : "Enhance"}
                </Button>
              ) : (
                <button
                  type="button"
                  data-testid="studio-enhance-setup-button"
                  onClick={onOpenSetup}
                  className="inline-flex w-full items-center justify-center gap-3 rounded-[22px] border border-[rgba(216,141,67,0.24)] bg-[rgba(216,141,67,0.12)] px-5 py-4 text-[0.9rem] font-semibold text-[#ffd7af] transition hover:border-[rgba(216,141,67,0.36)] hover:text-white"
                >
                  <Sparkles className="size-4.5" />
                  Set up enhancement
                </button>
              )}
              <Button
                type="button"
                data-testid="studio-enhance-use-prompt-button"
                onClick={onUsePrompt}
                disabled={!enhancedPrompt}
                variant="subtle"
                className="h-auto w-full gap-3 rounded-[20px] px-5 py-4 text-sm font-semibold text-white/86"
              >
                Use Prompt
              </Button>
              <Button
                type="button"
                onClick={onClose}
                variant="subtle"
                className="h-auto w-full rounded-[18px] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/76"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
