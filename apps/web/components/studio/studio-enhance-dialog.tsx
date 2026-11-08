"use client";

import {
  ArrowRight,
  ChartNoAxesColumn,
  ChevronDown,
  FileText,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { useId } from "react";

import { enhancementFailureMessage } from "@/lib/studio-enhancement";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";

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

export function StudioEnhanceDialog(props: StudioEnhanceDialogProps) {
  return props.open ? <StudioEnhanceDialogContent {...props} /> : null;
}

function StudioEnhanceDialogContent(props: StudioEnhanceDialogProps) {
  const { userPrompt, enhancedPrompt, busy, error, warnings, onClose } = props;
  const titleId = useId();
  const panelRef = useDialogFocus(onClose);
  const errorMessage = error ? enhancementFailureMessage(error) : null;

  return (
    <div
      data-testid="studio-enhance-dialog"
      className="studio-flow-backdrop studio-enhance-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        tabIndex={-1}
        className="admin-theme-root studio-browser-theme studio-flow-dialog studio-enhance-dialog"
      >
        <header className="studio-flow-header">
          <h2 id={titleId}>Prompt enhancer</h2>
          <IconButton
            icon={X}
            iconClassName="size-4"
            appearance="admin"
            size="compact"
            quiet
            aria-label="Close prompt enhancer"
            onClick={onClose}
          />
        </header>
        <div className="studio-flow-body studio-enhance-body">
          <div className="studio-enhance-comparison">
            <section className="studio-enhance-prompt">
              <h3>Original prompt</h3>
              <pre>{userPrompt || "No prompt entered yet."}</pre>
            </section>
            <ArrowRight className="studio-enhance-arrow" aria-hidden="true" />
            <section
              className="studio-enhance-prompt studio-enhance-result"
              aria-live="polite"
            >
              <h3>Enhanced prompt</h3>
              <pre data-testid="studio-enhance-preview-text">
                {enhancedPrompt ||
                  (busy
                    ? "Enhancing prompt..."
                    : "Run enhance to preview the rewritten prompt.")}
              </pre>
            </section>
          </div>
          <StudioEnhanceContext {...props} />
          {error ? (
            <div
              role="alert"
              className="callout-panel callout-panel-danger studio-enhance-notice"
            >
              {errorMessage}
              {error !== errorMessage ? (
                <details>
                  <summary tabIndex={0}>Enhancement details</summary>
                  <p>{error}</p>
                </details>
              ) : null}
            </div>
          ) : null}
          {warnings.length ? (
            <p role="status" className="studio-enhance-notice">
              {warnings.join(" ")}
            </p>
          ) : null}
        </div>
        <StudioEnhanceActions {...props} />
      </div>
    </div>
  );
}

function StudioEnhanceContext({
  previewVisual,
  imageAnalysisText,
  currentModelLabel,
  currentPresetLabel,
  providerLabel,
  providerModelId,
  modeLabel,
  readinessLabel,
  imageAnalysisStatus,
}: StudioEnhanceDialogProps) {
  return (
    <div className="studio-enhance-context">
      <section className="studio-enhance-reference">
        <h3>Reference</h3>
        <div className="studio-enhance-reference-frame">
          {previewVisual ? (
            <img src={previewVisual} alt="Enhancement reference" />
          ) : (
            <p>No image reference is staged for this enhancement preview.</p>
          )}
        </div>
      </section>
      <div className="studio-enhance-config">
        <p>Uses configured enhancement model</p>
        <dl>
          <div>
            <dt>Provider</dt>
            <dd>{providerLabel}</dd>
          </div>
          <div>
            <dt>Enhancement model</dt>
            <dd>{providerModelId ?? "Not selected"}</dd>
          </div>
          <div>
            <dt>Readiness</dt>
            <dd>{readinessLabel}</dd>
          </div>
        </dl>
        <details className="studio-enhance-details">
          <summary tabIndex={0}>
            Preview details <ChevronDown aria-hidden="true" />
          </summary>
          <dl>
            <div>
              <dt>Model</dt>
              <dd>{currentModelLabel ?? "Unknown model"}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{modeLabel}</dd>
            </div>
            <div>
              <dt>Preset</dt>
              <dd>{currentPresetLabel ?? "No preset selected"}</dd>
            </div>
            <div>
              <dt>Image reference</dt>
              <dd>{previewVisual ? "Attached" : "None"}</dd>
            </div>
          </dl>
        </details>
      </div>
      <details className="studio-enhance-details studio-enhance-analysis">
        <summary tabIndex={0}>
          <ChartNoAxesColumn aria-hidden="true" /> Image analysis{" "}
          <ChevronDown aria-hidden="true" />
        </summary>
        <p className="studio-enhance-analysis-status">{imageAnalysisStatus}</p>
        <p>
          {imageAnalysisText ||
            (previewVisual
              ? "No image analysis output is available for this preview yet."
              : "No image reference is staged, so there is nothing to analyze.")}
        </p>
      </details>
    </div>
  );
}

function StudioEnhanceActions({
  configuredForModel,
  busy,
  hasSavedSystemPrompt,
  enhancedPrompt,
  error,
  onRequestPreview,
  onOpenSetup,
  onUsePrompt,
  onClose,
}: Pick<
  StudioEnhanceDialogProps,
  | "configuredForModel"
  | "busy"
  | "hasSavedSystemPrompt"
  | "enhancedPrompt"
  | "error"
  | "onRequestPreview"
  | "onOpenSetup"
  | "onUsePrompt"
  | "onClose"
>) {
  return (
    <footer className="studio-flow-footer">
      {configuredForModel ? (
        <Button
          appearance="admin"
          variant="primary"
          size="compact"
          data-testid="studio-enhance-run-button"
          onClick={onRequestPreview}
          disabled={busy || !hasSavedSystemPrompt}
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {busy ? "Enhancing..." : enhancedPrompt ? "Enhance again" : "Enhance"}
        </Button>
      ) : (
        <Button
          appearance="admin"
          variant="primary"
          size="compact"
          data-testid="studio-enhance-setup-button"
          onClick={onOpenSetup}
        >
          <Sparkles className="size-4" /> Set up enhancement
        </Button>
      )}
      <Button
        appearance="admin"
        variant="subtle"
        size="compact"
        data-testid="studio-enhance-use-prompt-button"
        onClick={onUsePrompt}
        disabled={busy || Boolean(error) || !enhancedPrompt}
      >
        <FileText className="size-4" /> Use prompt
      </Button>
      <Button
        appearance="admin"
        variant="subtle"
        size="compact"
        className="studio-flow-cancel"
        onClick={onClose}
      >
        <X className="size-4" /> Cancel
      </Button>
    </footer>
  );
}
