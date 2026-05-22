"use client";

import { X } from "lucide-react";

import { MediaModelsConsole } from "@/components/media-models-console";
import type { MediaEnhancementConfig, MediaModelSummary, MediaPreset } from "@/lib/types";

type StudioSettingsModalProps = {
  models: MediaModelSummary[];
  presets: MediaPreset[];
  enhancementConfigs: MediaEnhancementConfig[];
  initialSelectedModelKey: string;
  onClose: () => void;
};

export function StudioSettingsModal({
  models,
  presets,
  enhancementConfigs,
  initialSelectedModelKey,
  onClose,
}: StudioSettingsModalProps) {
  return (
    <div className="studio-modal-backdrop fixed inset-0 z-[118] overflow-y-auto overscroll-contain backdrop-blur-md [webkit-overflow-scrolling:touch]">
      <div className="min-h-dvh p-0 lg:p-6">
        <div className="studio-modal-panel flex min-h-dvh min-w-0 flex-col lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[34px] lg:border lg:border-[var(--surface-overlay-border)]">
          <div className="studio-modal-header flex items-center justify-between gap-3 px-4 py-4 md:px-6">
            <div>
              <div className="admin-label-accent">
                Studio Settings
              </div>
              <div className="mt-1 text-sm text-[var(--text-muted)]">
                Configure the current model, system prompt, and presets without leaving Studio.
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="studio-icon-button h-10 w-10"
              aria-label="Close studio settings"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6 md:py-6">
            <MediaModelsConsole
              models={models}
              presets={presets}
              enhancementConfigs={enhancementConfigs}
              initialSelectedModelKey={initialSelectedModelKey}
              variant="studio"
              sections={{
                queue: false,
                enhancementProvider: false,
                modelHelper: true,
                studioSettings: false,
                modelPanel: true,
                presets: false,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
