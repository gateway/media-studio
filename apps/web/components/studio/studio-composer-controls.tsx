"use client";

import {
  Clapperboard,
  Coins,
  Copy,
  Image as ImageIcon,
  Info,
  Sparkles,
  ScanLine,
  Search,
  Shield,
  type LucideIcon,
} from "lucide-react";

import { AdminToggle } from "@/components/admin-controls";
import { isSeedanceModel } from "@/lib/seedance-model";
import { PillSelect, type PillSelectChoice } from "@/components/ui/pill-select";
import {
  buildChoiceList,
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
  inferredInputPattern: string | null;
  canSubmit: boolean;
  generateButtonLabel: string;
  onOpenPickerChange: (pickerId: string | null) => void;
  onOutputCountChange: (count: number) => void;
  onOptionChange: (optionKey: string, value: unknown) => void;
  onClear: () => void;
  onSubmit: () => void;
};

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

export function StudioComposerControls({
  structuredPresetActive,
  modelPicker,
  openPicker,
  modelKey,
  presetPicker,
  imageGenerateAction = false,
  showEstimate = false,
  estimatedCredits,
  modelMaxOutputs,
  outputCount,
  compactOptionEntries,
  optionValues,
  inferredInputPattern,
  canSubmit,
  generateButtonLabel,
  onOpenPickerChange,
  onOutputCountChange,
  onOptionChange,
  onClear,
  onSubmit,
}: StudioComposerControlsProps) {
  const hideAspectRatio =
    modelKey === "kling-3.0-i2v" &&
    inferredInputPattern === "first_last_frames";
  const optionControls = composerOptionEntries(
    modelKey,
    compactOptionEntries,
  ).flatMap(([optionKey, schema]) => {
    if (hideAspectRatio && optionKey === "aspect_ratio") {
      return [];
    }

    const currentValue = optionValues[optionKey];
    const resolvedValue = currentValue ?? schema.default;
    const choices = buildChoiceList(optionKey, schema, currentValue);
    const [firstChoice = { label: "Select" }] = choices;
    const resolvedLabel =
      resolvedValue == null || resolvedValue === ""
        ? firstChoice.label
        : displayChoiceLabel(optionKey, schema, resolvedValue);
    const selectedValue = serializeOptionChoice(resolvedValue);
    return [
      {
        optionKey,
        schema,
        currentValue,
        resolvedValue,
        resolvedLabel,
        controlLabel: composerControlLabel(modelKey, optionKey, resolvedLabel),
        selectedValue,
        choices: choices.length
          ? choices
          : [{ value: selectedValue, label: resolvedLabel }],
        hasChoices: choices.length > 0,
      },
    ];
  });

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

        {optionControls.map(
          ({
            optionKey,
            schema,
            currentValue,
            resolvedValue,
            controlLabel,
            selectedValue,
            choices,
            hasChoices,
          }) => {
            const toggle = seedanceToggleControl(modelKey, optionKey, schema);
            if (toggle) {
              return (
                <StudioSeedanceOptionToggle
                  key={optionKey}
                  {...toggle}
                  checked={resolvedValue === true}
                  onToggle={() =>
                    onOptionChange(optionKey, resolvedValue !== true)
                  }
                />
              );
            }
            if (!hasChoices && schema.type === "int_range") {
              return (
                <StudioNumericOptionControl
                  key={optionKey}
                  optionKey={optionKey}
                  schema={schema}
                  resolvedValue={resolvedValue}
                  onOptionChange={onOptionChange}
                />
              );
            }

            return (
              <PillSelect
                key={optionKey}
                pickerId={optionKey}
                open={openPicker === optionKey}
                onToggle={() =>
                  onOpenPickerChange(
                    openPicker === optionKey ? null : optionKey,
                  )
                }
                onClose={() => onOpenPickerChange(null)}
                widthClassName={pickerWidth(optionKey)}
                icon={optionIcon(optionKey, currentValue)}
                choiceIcon={(choice) =>
                  optionIcon(optionKey, parseOptionChoice(schema, choice.value))
                }
                label={controlLabel}
                selectedValue={selectedValue}
                menuTitle={optionKey.replaceAll("_", " ")}
                choices={choices}
                onSelect={(value) =>
                  onOptionChange(optionKey, parseOptionChoice(schema, value))
                }
              />
            );
          },
        )}
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
            {imageGenerateAction ? <ImageIcon aria-hidden="true" /> : null}
            {imageGenerateAction
              ? generateButtonLabel.replace(/^Generate\b/, "Generate image")
              : generateButtonLabel}
          </button>
        </div>
      </div>
    </div>
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
      <span>Estimate pending</span>
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

function StudioSeedanceOptionToggle({
  label,
  icon: Icon,
  checked,
  onToggle,
}: {
  label: string;
  icon: LucideIcon;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="studio-seedance-option-toggle">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <span className="studio-seedance-option-state" aria-hidden="true">
        {checked ? "On" : "Off"}
      </span>
      <AdminToggle checked={checked} ariaLabel={label} onToggle={onToggle} />
    </div>
  );
}

function StudioNumericOptionControl({
  optionKey,
  schema,
  resolvedValue,
  onOptionChange,
}: {
  optionKey: string;
  schema: Record<string, unknown>;
  resolvedValue: unknown;
  onOptionChange: StudioComposerControlsProps["onOptionChange"];
}) {
  const min = typeof schema.min === "number" ? schema.min : undefined;
  const max = typeof schema.max === "number" ? schema.max : undefined;
  const numericValue = Number(resolvedValue ?? min ?? 0);
  return (
    <label className="flex h-10 w-[calc(50%-0.25rem)] items-center gap-2 rounded-[18px] border border-white/10 bg-white/[0.045] px-3 text-[0.72rem] text-white/78 sm:w-[112px]">
      <span className="truncate capitalize">
        {optionKey.replaceAll("_", " ")}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={Number.isFinite(numericValue) ? numericValue : ""}
        onChange={(event) => {
          const parsed = Number(event.currentTarget.value);
          onOptionChange(
            optionKey,
            Number.isFinite(parsed) ? parsed : event.currentTarget.value,
          );
        }}
        className="min-w-0 flex-1 bg-transparent text-right text-white outline-none"
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
  if (!isSeedanceModel(modelKey)) return entries;
  return [...entries].sort(
    ([left], [right]) =>
      (seedanceOptionOrder.get(left) ?? seedanceOptionOrder.size) -
      (seedanceOptionOrder.get(right) ?? seedanceOptionOrder.size),
  );
}

function composerControlLabel(
  modelKey: string,
  optionKey: string,
  valueLabel: string,
) {
  if (isSeedanceModel(modelKey)) return valueLabel;
  return displayOptionControlLabel(optionKey, valueLabel);
}
