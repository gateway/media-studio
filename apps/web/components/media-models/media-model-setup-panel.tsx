"use client";

import {
  Box,
  Clapperboard,
  Clock3,
  Frame,
  Image as ImageIcon,
  Monitor,
  Music4,
  ScanSearch,
  SlidersHorizontal,
  Sparkles,
  Video,
} from "lucide-react";
import { useState } from "react";

import { AdminButton, AdminField, AdminInput, AdminSelect, AdminToggle } from "@/components/admin-controls";
import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import {
  CalloutPanel,
  PropertyStack,
  PropertyStackItem,
  SurfaceInset,
  surfaceCardClassName,
} from "@/components/ui/surface-primitives";
import { STUDIO_NANO_MAX_OUTPUTS } from "@/lib/media-studio-helpers";
import { supportedModelInputPatterns } from "@/lib/studio-model-support";
import type { MediaModelQueuePolicy, MediaModelSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

function studioSupportLabel(model: MediaModelSummary | null) {
  if (model?.studio_support_status === "generic_supported") {
    return "Generic support";
  }
  if (model?.studio_support_status === "unsupported") {
    return "Hidden until ready";
  }
  return "Fully supported";
}

function studioSupportTone(model: MediaModelSummary | null): "success" | "warning" | "danger" {
  if (model?.studio_support_status === "generic_supported") {
    return "warning";
  }
  if (model?.studio_support_status === "unsupported") {
    return "danger";
  }
  return "success";
}

function modelOptionIcon(key: string) {
  if (key === "duration") {
    return Clock3;
  }
  if (key === "sound") {
    return Music4;
  }
  if (key === "aspect_ratio") {
    return Frame;
  }
  if (key === "resolution" || key === "format") {
    return Monitor;
  }
  if (key === "negative_prompt") {
    return ScanSearch;
  }
  return SlidersHorizontal;
}

function firstPresentRecord(...values: Array<Record<string, unknown> | null | undefined>) {
  for (const value of values) {
    if (value && typeof value === "object") {
      return value;
    }
  }
  return null;
}

function formatAllowed(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    return null;
  }
  return value.map((item) => String(item)).join(", ");
}

function modelParameterRows(model: MediaModelSummary | null) {
  if (!model) {
    return [];
  }
  const rows: Array<{ name: string; required: string; description: string; icon?: typeof SlidersHorizontal }> = [];
  const imageInputs = firstPresentRecord(model.image_inputs);
  const videoInputs = firstPresentRecord(model.video_inputs);
  const audioInputs = firstPresentRecord(model.audio_inputs);
  const inputConstraints = firstPresentRecord(model.input_constraints);
  const options = firstPresentRecord(model.options);
  const prompt = firstPresentRecord(model.prompt);

  const imageRequiredMax = Number(imageInputs?.required_max ?? 0);
  const imageRequiredMin = Number(imageInputs?.required_min ?? 0);
  const videoRequiredMax = Number(videoInputs?.required_max ?? 0);
  const videoRequiredMin = Number(videoInputs?.required_min ?? 0);
  const audioRequiredMax = Number(audioInputs?.required_max ?? 0);
  const audioRequiredMin = Number(audioInputs?.required_min ?? 0);

  if (imageRequiredMax > 0 || imageRequiredMin > 0) {
    const imageFormats = formatAllowed(inputConstraints?.image_formats);
    const imageMaxMb = inputConstraints?.image_max_mb ? `${inputConstraints.image_max_mb}MB max` : null;
    rows.push({
      name: imageRequiredMax > 1 ? "images" : "image",
      required: "Yes",
      description: [
        imageRequiredMin === imageRequiredMax ? `${imageRequiredMax} required` : `${imageRequiredMin}-${imageRequiredMax} required`,
        imageFormats ? `formats: ${imageFormats}` : null,
        imageMaxMb,
      ]
        .filter(Boolean)
        .join(" · "),
      icon: ImageIcon,
    });
  }

  if (videoRequiredMax > 0 || videoRequiredMin > 0) {
    const videoFormats = formatAllowed(inputConstraints?.video_formats);
    const videoMaxMb = inputConstraints?.video_max_mb ? `${inputConstraints.video_max_mb}MB max` : null;
    rows.push({
      name: videoRequiredMax > 1 ? "videos" : "video",
      required: "Yes",
      description: [
        videoRequiredMin === videoRequiredMax ? `${videoRequiredMax} required` : `${videoRequiredMin}-${videoRequiredMax} required`,
        videoFormats ? `formats: ${videoFormats}` : null,
        videoMaxMb,
      ]
        .filter(Boolean)
        .join(" · "),
      icon: Video,
    });
  }

  if (audioRequiredMax > 0 || audioRequiredMin > 0) {
    rows.push({
      name: audioRequiredMax > 1 ? "audio files" : "audio",
      required: "Yes",
      description: audioRequiredMin === audioRequiredMax ? `${audioRequiredMax} required` : `${audioRequiredMin}-${audioRequiredMax} required`,
      icon: Music4,
    });
  }

  if (prompt && prompt.required) {
    rows.push({
      name: "prompt",
      required: "Yes",
      description: [prompt.max_chars ? `${prompt.max_chars} characters max` : null, prompt.enhancement_supported ? "Enhance supported" : null]
        .filter(Boolean)
        .join(" · "),
      icon: Sparkles,
    });
  }

  const optionRows =
    Array.isArray(model.studio_dynamic_options) && model.studio_dynamic_options.length
      ? model.studio_dynamic_options.map((option) => [option.key, option] as const)
      : Object.entries(options ?? {});

  for (const [key, option] of optionRows) {
    const optionRecord = option as Record<string, unknown>;
    const allowed = formatAllowed(optionRecord.allowed);
    const range =
      optionRecord.min !== null && optionRecord.min !== undefined && optionRecord.max !== null && optionRecord.max !== undefined
        ? `${optionRecord.min}-${optionRecord.max}`
        : null;
    const defaultValue =
      optionRecord.default !== null && optionRecord.default !== undefined && optionRecord.default !== ""
        ? `default: ${String(optionRecord.default)}`
        : null;
    rows.push({
      name: typeof optionRecord.label === "string" && optionRecord.label ? optionRecord.label : key,
      required: optionRecord.required ? "Yes" : "No",
      description: [allowed, range ? `range: ${range}` : null, defaultValue].filter(Boolean).join(" · "),
      icon: modelOptionIcon(key),
    });
  }

  return rows;
}

type MediaModelSetupPanelProps = {
  models: MediaModelSummary[];
  selectedModelKey: string;
  onSelectedModelKeyChange: (value: string) => void;
  selectedModel: MediaModelSummary | null;
  currentQueuePolicy: MediaModelQueuePolicy | null;
  isSaving: boolean;
  onToggleAvailability: () => void;
  onMaxOutputsChange: (nextValue: number) => void;
  onSaveQueuePolicy: () => void;
};

export function MediaModelSetupPanel({
  models,
  selectedModelKey,
  onSelectedModelKeyChange,
  selectedModel,
  currentQueuePolicy,
  isSaving,
  onToggleAvailability,
  onMaxOutputsChange,
  onSaveQueuePolicy,
}: MediaModelSetupPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const parameterRows = modelParameterRows(selectedModel);
  const supportedInputPatterns = selectedModel?.studio_supported_input_patterns ?? selectedModel?.input_patterns ?? [];
  const detectedInputPatterns = supportedModelInputPatterns(selectedModel);
  const inputPatternValue = supportedInputPatterns.join(", ") || detectedInputPatterns.join(", ") || "Not detected";

  return (
    <Panel className={surfaceCardClassName({ appearance: "admin", className: "px-5 py-5" })}>
      <PanelHeader
        eyebrow="Supported Models"
        title="Model Setup"
        description="Choose one model, then review what it accepts, how operators use it, and how Studio is configured for it."
      />
      <div className="mt-5 max-w-full sm:max-w-[340px]">
        <label className="grid gap-2">
          <span className="admin-field-label">Model</span>
          <AdminSelect
            open={pickerOpen}
            onToggle={() => setPickerOpen((current) => !current)}
            value={selectedModelKey}
            choices={models.map((model) => ({ value: model.key, label: model.label }))}
            onSelect={(nextValue) => {
              onSelectedModelKeyChange(nextValue);
              setPickerOpen(false);
            }}
            className="admin-model-select"
          />
        </label>
      </div>
      <div className="mt-4 max-w-[780px] text-sm leading-7 text-[var(--muted-strong)]">
        Everything below belongs to <span className="font-medium text-[var(--foreground)]">{selectedModel?.label ?? selectedModelKey}</span>, so you can review the model, decide how many outputs it can create at once, and tune how Enhance rewrites prompts for it.
      </div>
      {selectedModel ? (
        <div className="mt-5 grid gap-4">
          <PropertyStack appearance="admin" className="grid gap-3 sm:grid-cols-4">
            <PropertyStackItem appearance="admin" label="Studio support" value={studioSupportLabel(selectedModel)} />
            <PropertyStackItem
              appearance="admin"
              label="Studio exposure"
              value={selectedModel.studio_exposed === false ? "Hidden from Studio" : "Visible in Studio"}
            />
            <PropertyStackItem appearance="admin" label="Input patterns" value={inputPatternValue} />
            <PropertyStackItem appearance="admin" label="KIE spec" value={selectedModel.kie_spec_version ?? "Not reported"} />
          </PropertyStack>
          {selectedModel.studio_support_summary ? (
            <CalloutPanel appearance="admin" tone={studioSupportTone(selectedModel)}>
              <div className="text-sm leading-6 text-[var(--foreground)]">{selectedModel.studio_support_summary}</div>
            </CalloutPanel>
          ) : null}
          {selectedModel.studio_unsupported_option_keys?.length ? (
            <CalloutPanel appearance="admin" tone="warning">
              <div className="text-sm leading-6 text-[var(--foreground)]">
                Unsupported Studio controls: {selectedModel.studio_unsupported_option_keys.join(", ")}
              </div>
            </CalloutPanel>
          ) : null}
        </div>
      ) : null}
      <div className="mt-5 grid gap-4">
        <div className="grid gap-4">
          <div className="admin-icon-label-row admin-label-muted">
            <Sparkles className="size-3.5 text-[rgba(208,255,72,0.94)]" />
            Parameters
          </div>
          <div className="mt-3 overflow-hidden">
            {parameterRows.length ? (
              <div className="grid">
                <div className="admin-property-grid-header grid-cols-[minmax(0,0.9fr)_80px_minmax(0,1.6fr)]">
                  <div>Parameter</div>
                  <div>Required</div>
                  <div>Description</div>
                </div>
                {parameterRows.slice(0, 8).map((row) => {
                  const Icon = row.icon ?? SlidersHorizontal;
                  return (
                    <div
                      key={`${selectedModelKey}-parameter-${row.name}`}
                      className="admin-property-grid-row grid-cols-[minmax(0,0.9fr)_80px_minmax(0,1.6fr)] last:border-b-0"
                    >
                      <div className="flex items-center gap-2 text-[var(--foreground)]">
                        <Icon className="size-3.5 shrink-0 text-[rgba(208,255,72,0.94)]" />
                        <span className="truncate font-medium">{row.name}</span>
                      </div>
                      <div className="text-[var(--foreground)]">{row.required}</div>
                      <div className="text-[var(--muted-strong)]">{row.description}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-3 text-sm leading-7 text-[var(--muted-strong)]">No published capability details.</div>
            )}
          </div>
          <div className={surfaceCardClassName({ appearance: "admin", className: "px-5 py-5" })}>
            <div className="admin-icon-label-row admin-label-muted">
              <Clapperboard className="size-3.5" />
              Queue Controls
            </div>
            <SurfaceInset appearance="admin" density="compact" className="admin-row-surface mt-4">
              <div className="grid gap-1">
                <div className="flex items-center gap-2">
                  <span className="admin-label-muted">Availability</span>
                  <StatusPill
                    label={(currentQueuePolicy?.enabled ?? true) ? "Enabled" : "Disabled"}
                    tone={(currentQueuePolicy?.enabled ?? true) ? "healthy" : "warning"}
                  />
                </div>
                <div className="text-sm leading-6 text-[var(--muted-strong)]">
                  Turn a model off to hide it from Studio and block new submissions without removing any saved history.
                </div>
              </div>
              <AdminToggle
                checked={currentQueuePolicy?.enabled ?? true}
                ariaLabel={`${(currentQueuePolicy?.enabled ?? true) ? "Disable" : "Enable"} ${selectedModel?.label ?? selectedModelKey}`}
                onToggle={onToggleAvailability}
              />
            </SurfaceInset>
            <div className="mt-4 text-sm leading-6 text-[var(--muted-strong)]">
              Set how many results this model can create in one run. Studio caps this at 10, and the queue will process any excess over the active runner slots as queued jobs.
            </div>
            <div className="mt-4 flex flex-nowrap items-end gap-3">
              <AdminField label="Outputs per run" className="w-[156px] shrink-0">
                <AdminInput
                  type="number"
                  min={1}
                  max={STUDIO_NANO_MAX_OUTPUTS}
                  step={1}
                  value={String(currentQueuePolicy?.max_outputs_per_run ?? 1)}
                  onChange={(event) =>
                    onMaxOutputsChange(
                      Math.min(Math.max(1, Number(event.target.value) || 1), STUDIO_NANO_MAX_OUTPUTS),
                    )
                  }
                />
              </AdminField>
              <div className="shrink-0 pb-[1px]">
                <AdminButton onClick={onSaveQueuePolicy} disabled={isSaving} size="compact">
                  Save
                </AdminButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
