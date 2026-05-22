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
    <div data-testid="studio-enhance-dialog" className="studio-modal-backdrop fixed inset-0 z-[125] backdrop-blur-md">
      <div className="absolute inset-0 p-3 md:p-6">
        <div className="studio-modal-panel grid h-full gap-4 rounded-[34px] border border-[var(--surface-overlay-border)] p-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:p-6">
          <div className="studio-enhance-workspace grid min-h-0 gap-4 overflow-hidden rounded-[30px] p-4 lg:p-6">
            <div className="studio-enhance-preview-frame relative overflow-hidden rounded-[28px]">
              {previewVisual ? (
                <div className="flex min-h-[260px] items-center justify-center p-4 sm:min-h-[340px] sm:p-5">
                  <img
                    src={previewVisual}
                    alt="Enhancement reference"
                    className="max-h-[50vh] w-auto max-w-full rounded-[24px] object-contain shadow-[var(--shadow-overlay)]"
                  />
                </div>
              ) : (
                <div className="flex min-h-[260px] items-center justify-center px-6 text-center text-sm text-[var(--text-muted)] sm:min-h-[340px]">
                  No image reference is staged for this enhancement preview.
                </div>
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="studio-panel-compact p-4">
                <div className="studio-field-label">User prompt</div>
                <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--text-muted)]">
                  {userPrompt || "No prompt entered yet."}
                </pre>
              </div>
              <div className="studio-enhance-accent-panel p-4">
                <div className="studio-field-label text-[var(--feedback-warning-text)]">Enhanced prompt</div>
                <pre data-testid="studio-enhance-preview-text" className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--text-primary)]">
                  {enhancedPrompt || (busy ? "Enhancing prompt..." : "Run enhance to preview the rewritten prompt.")}
                </pre>
              </div>
              <div className="studio-panel-compact p-4 xl:col-span-2">
                <div className="studio-field-label">Image analysis</div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--text-muted)]">
                  {imageAnalysisText
                    ? imageAnalysisText
                    : previewVisual
                      ? "No image analysis output is available for this preview yet."
                      : "No image reference is staged, so there is nothing to analyze."}
                </div>
              </div>
            </div>
          </div>

          <div className="studio-panel grid auto-rows-max gap-4 overflow-y-auto rounded-[28px] p-4 text-[var(--text-primary)] lg:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="studio-field-label">Enhance prompt</div>
                <div className="mt-1 text-base font-semibold text-[var(--text-primary)]">{currentModelLabel ?? "Unknown model"}</div>
                <div className="mt-1 text-sm text-[var(--text-muted)]">Preview the rewrite, then send it back to the composer.</div>
              </div>
              <button type="button" onClick={onClose} className="studio-icon-button h-10 w-10">
                <X className="size-5" />
              </button>
            </div>

            <div className="studio-panel-compact p-4">
              <div className="studio-field-label">Preview summary</div>
              <div className="mt-3 grid gap-3 text-sm leading-6 text-[var(--text-muted)]">
                <div>
                  <span className="text-[var(--text-dim)]">Model:</span> {currentModelLabel ?? "Unknown model"}
                </div>
                <div>
                  <span className="text-[var(--text-dim)]">Enhancement provider:</span> {providerLabel}
                </div>
                <div>
                  <span className="text-[var(--text-dim)]">Enhancement model:</span> {providerModelId ?? "Not selected"}
                </div>
                <div>
                  <span className="text-[var(--text-dim)]">Enhancement mode:</span> {modeLabel}
                </div>
                <div>
                  <span className="text-[var(--text-dim)]">Readiness:</span> {readinessLabel}
                </div>
                <div>
                  <span className="text-[var(--text-dim)]">Preset:</span> {currentPresetLabel ?? "No preset selected"}
                </div>
                <div>
                  <span className="text-[var(--text-dim)]">Image reference:</span> {previewVisual ? "Attached" : "None"}
                </div>
                <div>
                  <span className="text-[var(--text-dim)]">Image analysis:</span> {imageAnalysisStatus}
                </div>
              </div>
            </div>

            {error ? (
              <div className="callout-panel callout-panel-danger px-4 py-3 text-sm">
                {error}
              </div>
            ) : null}
            {warnings.length ? (
              <div className="studio-panel-compact px-4 py-3 text-sm text-[var(--text-muted)]">
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
                  className="h-auto w-full gap-3 rounded-[22px] px-5 py-4 text-[0.98rem] font-semibold"
                >
                  {busy ? <LoaderCircle className="size-4.5 animate-spin" /> : <Sparkles className="size-4.5" />}
                  {busy ? "Enhancing..." : "Enhance"}
                </Button>
              ) : (
                <button
                  type="button"
                  data-testid="studio-enhance-setup-button"
                  onClick={onOpenSetup}
                  className="studio-enhance-accent-panel inline-flex w-full items-center justify-center gap-3 px-5 py-4 text-[0.9rem] font-semibold text-[var(--feedback-warning-text)] transition hover:border-[var(--action-warning-border)] hover:text-[var(--text-primary)]"
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
                className="h-auto w-full gap-3 rounded-[20px] px-5 py-4 text-sm font-semibold"
              >
                Use Prompt
              </Button>
              <Button
                type="button"
                onClick={onClose}
                variant="subtle"
                className="h-auto w-full rounded-[18px] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em]"
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
