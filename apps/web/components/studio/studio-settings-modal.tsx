"use client";

import { X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";

import { MediaModelsConsole } from "@/components/media-models-console";
import type {
  MediaEnhancementConfig,
  MediaModelSummary,
  MediaPreset,
} from "@/lib/types";

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
  const titleId = useId();
  const panelRef = useDialogFocus(onClose);
  return (
    <div className="studio-flow-backdrop studio-settings-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="admin-theme-root studio-settings-theme studio-flow-dialog"
      >
        <header className="studio-flow-header">
          <div>
            <h2 id={titleId}>Studio Settings</h2>
            <p>
              Configure the current model, system prompt, and presets without
              leaving Studio.
            </p>
          </div>
          <IconButton
            icon={X}
            iconClassName="size-4"
            appearance="admin"
            size="compact"
            quiet
            aria-label="Close studio settings"
            onClick={onClose}
          />
        </header>
        <div className="studio-flow-body studio-settings-body">
          <MediaModelsConsole
            models={models}
            presets={presets}
            enhancementConfigs={enhancementConfigs}
            initialSelectedModelKey={initialSelectedModelKey}
            variant="studio"
            sections={{
              queue: false,
              modelHelper: true,
              studioSettings: false,
              modelPanel: true,
              presets: false,
            }}
          />
        </div>
        <footer className="studio-flow-footer">
          <Button
            appearance="admin"
            variant="subtle"
            size="compact"
            className="studio-flow-cancel"
            onClick={onClose}
          >
            Close
          </Button>
        </footer>
      </div>
    </div>
  );
}
