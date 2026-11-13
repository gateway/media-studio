"use client";

import {
  ChevronDown,
  Clapperboard,
  Coins,
  Copy,
  Video,
  Image as ImageIcon,
  Info,
  Sparkles,
  ScanLine,
  Search,
  Shield,
  type LucideIcon,
} from "lucide-react";

import { useId, useState } from "react";

import { AdminToggle } from "@/components/admin-controls";
import { Button } from "@/components/ui/button";
import { isSeedanceModel } from "@/lib/seedance-model";
import { PillSelect, type PillSelectChoice } from "@/components/ui/pill-select";
import {
  buildChoiceList,
  MULTI_SHOT_MODEL_KEYS,
  displayChoiceLabel,
  displayOptionControlLabel,
  optionIcon,
  parseOptionChoice,
  pickerWidth,
  serializeOptionChoice,
} from "@/lib/media-studio-helpers";
import {
  studioComposerModelIcon,
  studioComposerModelLabel,
} from "@/hooks/studio/use-studio-shell-catalog";
import type { MediaModelSummary, MediaPreset } from "@/lib/types";
import { studioOutputGroups, studioOutputSelection } from "@/lib/studio-output";
import { cn } from "@/lib/utils";

type StudioComposerControlsProps = {
  structuredPresetActive: boolean;
  modelPicker?: React.ReactNode;
  openPicker: string | null;
  modelKey: string;
  presetPicker?: React.ReactNode;
  imageGenerateAction?: boolean;
  showEstimate?: boolean;
  estimatedCredits?: string | null;
  modelMaxOutputs: number;
  outputCount: number;
  compactOptionEntries: Array<[string, Record<string, unknown>]>;
  optionValues: Record<string, unknown>;
  draftOptionValues?: Record<string, unknown>;
  canSubmit: boolean;
  generateButtonLabel: string;
  onOpenPickerChange: (pickerId: string | null) => void;
  onOutputCountChange: (count: number) => void;
  onOptionChange: (optionKey: string, value: unknown) => void;
  onClear: () => void;
  onSubmit: () => void;
};

export function StudioComposerOutputPicker({
  entries,
  value,
  stillFormat,
  onSelect,
}: {
  entries: StudioComposerControlsProps["compactOptionEntries"];
  value: unknown;
  stillFormat?: unknown;
  onSelect: (format: string) => void;
}) {
  const groups = studioOutputGroups(entries);
  if (groups.length <= 1) return null;
  return (
    <div className="studio-composer-output-picker" role="group" aria-label="Output">
      {groups.map(({ key, label, formats }) => (
        <Button
          key={key}
          appearance="admin"
          variant="ghost"
          aria-pressed={formats.includes(String(value))}
          onClick={() => {
            if (formats.includes(String(value))) return;
            onSelect(formats.find((format) => format === stillFormat) ?? formats[0]);
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

export function StudioComposerModelPicker({
  model,
  modelKey,
  modelIcons,
  choices,
  presetModelChoices,
  structuredPresetActive,
  leading,
  open,
  onOpenChange,
  onSelect,
}: {
  model: MediaModelSummary | null;
  modelKey: string;
  modelIcons: ReadonlyMap<string, LucideIcon>;
  choices: PillSelectChoice[];
  presetModelChoices: PillSelectChoice[];
  structuredPresetActive: boolean;
  leading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
}) {
  if (structuredPresetActive && presetModelChoices.length <= 1) return null;
  const modelLabel = studioComposerModelLabel(model?.label);
  const label = leading
    ? modelLabel.replace(
        / (image to image|text to image)$/i,
        (_, mode: string) =>
          `\n${mode[0].toUpperCase()}${mode.slice(1).toLowerCase()}`,
      )
    : modelLabel;
  return (
    <PillSelect
      pickerId="model"
      viewportOverlay
      open={open}
      onToggle={() => onOpenChange(!open)}
      onClose={() => onOpenChange(false)}
      widthClassName={pickerWidth("model")}
      icon={studioComposerModelIcon(model)}
      choiceIcon={(choice) => modelIcons.get(choice.value) ?? Clapperboard}
      label={label}
      className={
        label === modelLabel ? undefined : "studio-model-picker-with-mode"
      }
      selectedValue={modelKey}
      menuTitle="Model"
      choices={structuredPresetActive ? presetModelChoices : choices}
      selectedChoiceFirst={false}
      onSelect={onSelect}
    />
  );
}

function composerPresetLabel(
  modelPresets: MediaPreset[],
  selectedPresetId: string,
  fallback: string,
) {
  return (
    modelPresets.find(({ preset_id }) => preset_id === selectedPresetId)
      ?.label ??
    modelPresets.find(({ key }) => key === selectedPresetId)?.label ??
    fallback
  );
}

export function StudioComposerPresetPicker({
  modelKey,
  modelPresets,
  selectedPresetId,
  structuredPresetActive,
  inBrowser,
  open,
  onOpenChange,
  onSelect,
}: {
  modelKey: string;
  modelPresets: MediaPreset[];
  selectedPresetId: string;
  structuredPresetActive: boolean;
  inBrowser: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string, options: { preferredModelKey: string }) => void;
}) {
  if (
    structuredPresetActive ||
    (!selectedPresetId && modelPresets.length === 0)
  )
    return null;
  return (
    <PillSelect
      pickerId="preset"
      viewportOverlay={!inBrowser}
      appearance={inBrowser ? "admin" : "studio"}
      open={open}
      onToggle={() => onOpenChange(!open)}
      onClose={() => onOpenChange(false)}
      widthClassName={pickerWidth("preset")}
      icon={Sparkles}
      label={composerPresetLabel(
        modelPresets,
        selectedPresetId,
        inBrowser ? "Presets for this model" : "Preset",
      )}
      selectedValue={selectedPresetId}
      menuTitle="Preset"
      choices={[
        { value: "", label: "No preset" },
        ...modelPresets.map((preset) => ({
          value: preset.preset_id,
          label: preset.label,
        })),
      ]}
      onSelect={(value) => onSelect(value, { preferredModelKey: modelKey })}
    />
  );
}

export function StudioComposerControls(props: StudioComposerControlsProps) {
  const {
    structuredPresetActive, modelPicker, openPicker, presetPicker, showEstimate = false,
    estimatedCredits, modelMaxOutputs, outputCount, canSubmit, generateButtonLabel,
    onOpenPickerChange, onOutputCountChange, onClear, onSubmit,
  } = props;
  const output = studioOutputSelection(props.compactOptionEntries, props.optionValues);
  const action = composerGenerateAction(output, props.imageGenerateAction);
  return (
    <div
      className={cn(
        "studio-composer-controls-bar",
        structuredPresetActive ? "pt-[6px]" : "",
      )}
    >
      <div className="studio-composer-options">
        {modelPicker}
        {presetPicker}

        {modelMaxOutputs > 1 ? (
          <PillSelect
            pickerId="output-count"
            viewportOverlay
            open={openPicker === "output-count"}
            onToggle={() =>
              onOpenPickerChange(
                openPicker === "output-count" ? null : "output-count",
              )
            }
            onClose={() => onOpenPickerChange(null)}
            widthClassName={pickerWidth("output-count")}
            icon={Copy}
            label={`${outputCount}`}
            selectedValue={String(outputCount)}
            menuTitle="Outputs"
            choices={Array.from({ length: modelMaxOutputs }, (_, index) => ({
              value: String(index + 1),
              label: String(index + 1),
            }))}
            onSelect={(value) =>
              onOutputCountChange(Math.max(1, Number(value) || 1))
            }
          />
        ) : null}

        <StudioComposerOptionFields {...props} output={output} />
      </div>
      <div className="studio-composer-actions flex w-full items-center gap-2 sm:w-auto sm:ml-auto">
        <StudioComposerEstimate
          show={showEstimate}
          credits={estimatedCredits}
          hasPrice={generateButtonLabel !== "Generate"}
        />
        <div className="studio-composer-action-group flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="studio-composer-action-button studio-composer-clear-button"
          >
            Clear
          </button>
          <button
            type="button"
            data-testid="studio-generate-button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="studio-composer-action-button studio-composer-generate-button"
          >
            {action === "Generate image" ? <ImageIcon aria-hidden="true" /> : null}
            {generateButtonLabel.replace(/^Generate\b/, action)}
          </button>
        </div>
      </div>
    </div>
  );
}

type OutputSelection = ReturnType<typeof studioOutputSelection>;

function composerGenerateAction(output: OutputSelection, imageAction?: boolean) {
  if (output.action && (output.grouped || output.action !== "image")) return `Generate ${output.action}`;
  return imageAction ? "Generate image" : "Generate";
}

function StudioComposerOptionFields(props: StudioComposerControlsProps & { output: OutputSelection }) {
  const { onOptionChange, output } = props;
  const { regular, advanced, secondary } = buildComposerOptionFields(props);
  return (
    <>
      {regular}
      {output.loopLabel && <span className="studio-composer-loop-length" aria-live="polite">{output.loopLabel}</span>}
      {advanced.length > 0 && (
        <details className="studio-composer-advanced-options">
          <summary>Advanced settings</summary>
          <div className="studio-composer-options">{advanced}</div>
        </details>
      )}
      {secondary.length > 0 && <StudioComposerMoreControls options={secondary} onOptionChange={onOptionChange} />}
    </>
  );
}

function buildComposerOptionFields({
  modelKey, compactOptionEntries, optionValues, draftOptionValues, output,
  openPicker, onOpenPickerChange, onOptionChange,
}: StudioComposerControlsProps & { output: OutputSelection }) {
  const regular: React.ReactNode[] = [];
  const advanced: React.ReactNode[] = [];
  const secondary: Array<{
    key: string; label: string; icon: LucideIcon; checked: boolean;
  }> = [];
  for (const [optionKey, schema] of composerOptionEntries(modelKey, compactOptionEntries)) {
    if (optionKey === "multi_shots" && MULTI_SHOT_MODEL_KEYS.has(modelKey)) continue;
    const value = optionValues[optionKey] ?? schema.default;
    const toggle = seedanceToggleControl(modelKey, optionKey, schema);
    if (toggle) {
      secondary.push({ key: optionKey, ...toggle, checked: value === true });
      continue;
    }
    const fields = schema.ui_group === "advanced" ? advanced : regular;
    fields.push(
      <StudioComposerOptionField
        key={optionKey}
        optionKey={optionKey}
        schema={schema}
        value={value}
        draftValue={draftOptionValues?.[optionKey]}
        output={output}
        {...{ modelKey, openPicker, onOpenPickerChange, onOptionChange }}
      />,
    );
  }
  return { regular, advanced, secondary };
}

function StudioComposerMoreControls({
  options,
  onOptionChange,
}: {
  options: Array<{
    key: string;
    label: string;
    icon: LucideIcon;
    checked: boolean;
  }>;
  onOptionChange: StudioComposerControlsProps["onOptionChange"];
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();

  return (
    <>
      <button
        type="button"
        aria-controls={id}
        aria-expanded={expanded}
        className="studio-composer-more-controls"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown aria-hidden="true" />
        More controls
      </button>
      <div
        id={id}
        className="studio-composer-secondary-options"
        data-expanded={expanded}
      >
        {options.map(({ key, checked, ...toggle }) => (
          <StudioComposerOptionToggle
            key={key}
            {...toggle}
            checked={checked}
            onToggle={() => onOptionChange(key, !checked)}
          />
        ))}
      </div>
    </>
  );
}

function StudioComposerEstimate({
  show,
  credits,
  hasPrice,
}: {
  show: boolean;
  credits?: string | null;
  hasPrice: boolean;
}) {
  if (!show) return null;
  if (credits) {
    return (
      <div className="studio-composer-estimate studio-composer-estimate-credits">
        <Coins aria-hidden="true" />
        <span>~{credits} credits</span>
      </div>
    );
  }
  if (hasPrice) return null;
  return (
    <div className="studio-composer-estimate">
      <Info aria-hidden="true" />
      <span>Estimate unavailable</span>
    </div>
  );
}

const seedanceToggleControls = {
  return_last_frame: { label: "Return last frame", icon: ScanLine },
  web_search: { label: "Web search", icon: Search },
  nsfw_checker: { label: "NSFW checker", icon: Shield },
};

function seedanceToggleControl(
  modelKey: string,
  optionKey: string,
  schema: Record<string, unknown>,
) {
  if (!isSeedanceModel(modelKey)) return null;
  if (!["bool", "boolean"].includes(String(schema.type))) return null;
  return (
    seedanceToggleControls[optionKey as keyof typeof seedanceToggleControls] ??
    null
  );
}

export function StudioComposerOptionToggle({
  label,
  icon: Icon,
  checked,
  onToggle,
  showState = true,
}: {
  label: string;
  icon: LucideIcon;
  showState?: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="studio-composer-option-toggle">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <span className="studio-composer-option-state" aria-hidden="true">
        {showState ? (checked ? "On" : "Off") : null}
      </span>
      <AdminToggle checked={checked} ariaLabel={label} onToggle={onToggle} />
    </div>
  );
}

function StudioComposerOptionField({
  optionKey,
  schema,
  value,
  draftValue,
  output,
  modelKey,
  openPicker,
  onOpenPickerChange,
  onOptionChange,
}: Pick<StudioComposerControlsProps, "modelKey" | "openPicker" | "onOpenPickerChange" | "onOptionChange"> & {
  optionKey: string;
  schema: Record<string, unknown>;
  value: unknown;
  draftValue: unknown;
  output: OutputSelection;
}) {
  const choices = composerFieldChoices(optionKey, schema, value, output.group);
  if (output.grouped && choices.length <= 1 && optionKey === "output_format") return null;
  if (!choices.length && isComposerOptionInput(schema)) {
    return <StudioOptionInput optionKey={optionKey} schema={schema} value={draftValue ?? value} onOptionChange={onOptionChange} />;
  }
  const selectedValue = serializeOptionChoice(value);
  const label = choiceControlLabel(modelKey, optionKey, schema, value, choices, output.grouped);
  const pickerClassName = outputPickerClassName(output);
  return (
    <PillSelect
      pickerId={optionKey}
      viewportOverlay
      open={openPicker === optionKey}
      onToggle={() => onOpenPickerChange(openPicker === optionKey ? null : optionKey)}
      onClose={() => onOpenPickerChange(null)}
      widthClassName={pickerWidth(optionKey)}
      icon={composerOptionIcon(modelKey, optionKey, value)}
      choiceIcon={(choice) => composerOptionIcon(modelKey, optionKey, parseOptionChoice(schema, choice.value))}
      className={pickerClassName}
      label={label}
      selectedValue={selectedValue}
      menuTitle={String(schema.label ?? optionKey.replaceAll("_", " "))}
      choices={composerOptionChoices(modelKey, optionKey, choices)}
      onSelect={(value) => onOptionChange(optionKey, parseOptionChoice(schema, value))}
    />
  );
}

function outputPickerClassName(output: OutputSelection) {
  if (!output.grouped) return undefined;
  return cn("studio-output-option", output.group?.key === "svg" && "studio-output-option-wide");
}

function isComposerOptionInput(schema: Record<string, unknown>) {
  return schema.type === "int_range" || schema.ui_control === "text";
}

function choiceControlLabel(
  modelKey: string,
  key: string,
  schema: Record<string, unknown>,
  value: unknown,
  choices: PillSelectChoice[],
  grouped: boolean,
) {
  const label = value == null || value === "" ? (choices[0]?.label ?? "Select") : displayChoiceLabel(key, schema, value);
  return grouped && typeof schema.label === "string"
    ? `${schema.label} · ${label}`
    : composerControlLabel(modelKey, key, label, value);
}

function StudioOptionInput({
  optionKey,
  schema,
  value,
  onOptionChange,
}: {
  optionKey: string;
  schema: Record<string, unknown>;
  value: unknown;
  onOptionChange: StudioComposerControlsProps["onOptionChange"];
}) {
  const numeric = schema.type === "int_range";
  return (
    <label className="studio-composer-option-input">
      <span>{String(schema.label ?? optionKey.replaceAll("_", " "))}</span>
      <input
        className="min-w-[6ch] w-0 flex-1 bg-transparent text-right"
        type={numeric ? "number" : "text"}
        min={typeof schema.min === "number" ? schema.min : undefined}
        max={typeof schema.max === "number" ? schema.max : undefined}
        step={typeof schema.ui_step === "number" ? schema.ui_step : undefined}
        value={String(value ?? "")}
        placeholder="Auto"
        onChange={(event) => {
          const { value, valueAsNumber } = event.currentTarget;
          onOptionChange(optionKey, numeric && value ? valueAsNumber : value);
        }}
      />
    </label>
  );
}

const seedanceOptionOrder = new Map(
  [
    "duration",
    "aspect_ratio",
    "resolution",
    "output_format",
    "generate_audio",
    "return_last_frame",
    "web_search",
    "nsfw_checker",
  ].map((key, index) => [key, index]),
);

function composerOptionEntries(
  modelKey: string,
  entries: StudioComposerControlsProps["compactOptionEntries"],
) {
  const order = isSeedanceModel(modelKey)
    ? seedanceOptionOrder
    : modelKey.startsWith("kling-")
      ? klingOptionOrder
      : null;
  if (!order) return entries;
  return [...entries].sort(
    ([left], [right]) =>
      (order.get(left) ?? order.size) - (order.get(right) ?? order.size),
  );
}

function composerControlLabel(
  modelKey: string,
  optionKey: string,
  valueLabel: string,
  value: unknown,
) {
  if (modelKey.startsWith("kling-")) {
    return klingOptionLabels[optionKey]?.[String(value)] ?? valueLabel;
  }
  if (isSeedanceModel(modelKey)) return valueLabel;
  return displayOptionControlLabel(optionKey, valueLabel);
}

const klingOptionOrder = new Map(
  [
    "character_orientation",
    "duration",
    "aspect_ratio",
    "mode",
    "resolution",
    "sound",
  ].map((key, index) => [key, index]),
);

function composerOptionIcon(
  modelKey: string,
  optionKey: string,
  value: unknown,
) {
  if (modelKey.startsWith("kling-") && optionKey === "character_orientation") {
    return value === "image" ? ImageIcon : Video;
  }
  if (
    modelKey.startsWith("kling-") &&
    optionKey === "mode" &&
    ["720p", "1080p"].includes(String(value))
  )
    return optionIcon("resolution", value);
  return optionIcon(optionKey, value);
}

const klingOptionLabels: Record<string, Record<string, string>> = {
  character_orientation: { image: "Image", video: "Video" },
  mode: { "720p": "720p", "1080p": "1080p", std: "Standard", pro: "Pro" },
};

function composerFieldChoices(
  optionKey: string,
  schema: Record<string, unknown>,
  value: unknown,
  outputGroup: ReturnType<typeof studioOutputGroups>[number] | undefined,
) {
  const choices = buildChoiceList(optionKey, schema, value);
  return optionKey === "output_format" && outputGroup
    ? choices.filter((choice) => outputGroup.formats.includes(choice.value))
    : choices;
}
function composerOptionChoices(
  modelKey: string,
  optionKey: string,
  choices: Array<{ value: string; label: string }>,
) {
  if (!modelKey.startsWith("kling-")) return choices;
  return choices.map((choice) => ({
    ...choice,
    label: composerControlLabel(
      modelKey,
      optionKey,
      choice.label,
      choice.value,
    ),
  }));
}
