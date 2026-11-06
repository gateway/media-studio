"use client";

import { Copy, Sparkles } from "lucide-react";

import { PillSelect } from "@/components/ui/pill-select";
import {
  buildChoiceList,
  displayChoiceLabel,
  displayOptionControlLabel,
  optionIcon,
  parseOptionChoice,
  pickerWidth,
  serializeOptionChoice,
} from "@/lib/media-studio-helpers";
import type { MediaPreset } from "@/lib/types";
import { cn } from "@/lib/utils";

type StudioComposerControlsProps = {
  structuredPresetActive: boolean;
  modelPicker?: React.ReactNode;
  openPicker: string | null;
  modelKey: string;
  selectedPresetId: string;
  modelPresets: MediaPreset[];
  modelMaxOutputs: number;
  outputCount: number;
  compactOptionEntries: Array<[string, Record<string, unknown>]>;
  optionValues: Record<string, unknown>;
  inferredInputPattern: string | null;
  canSubmit: boolean;
  generateButtonLabel: string;
  onOpenPickerChange: (pickerId: string | null) => void;
  onPresetSelection: (
    value: string,
    options?: { preferredModelKey?: string | null },
  ) => void;
  onOutputCountChange: (count: number) => void;
  onOptionChange: (optionKey: string, value: unknown) => void;
  onClear: () => void;
  onSubmit: () => void;
};

export function StudioComposerControls({
  structuredPresetActive,
  modelPicker,
  openPicker,
  modelKey,
  selectedPresetId,
  modelPresets,
  modelMaxOutputs,
  outputCount,
  compactOptionEntries,
  optionValues,
  inferredInputPattern,
  canSubmit,
  generateButtonLabel,
  onOpenPickerChange,
  onPresetSelection,
  onOutputCountChange,
  onOptionChange,
  onClear,
  onSubmit,
}: StudioComposerControlsProps) {
  const hideAspectRatio =
    modelKey === "kling-3.0-i2v" &&
    inferredInputPattern === "first_last_frames";
  const optionControls = compactOptionEntries.flatMap(([optionKey, schema]) => {
    if (hideAspectRatio && optionKey === "aspect_ratio") {
      return [];
    }

    const currentValue = optionValues[optionKey];
    const resolvedValue = currentValue ?? schema.default;
    const choices = buildChoiceList(modelKey, optionKey, schema, currentValue);
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
        {!structuredPresetActive &&
        (selectedPresetId || modelPresets.length) ? (
          <PillSelect
            pickerId="preset"
            open={openPicker === "preset"}
            onToggle={() =>
              onOpenPickerChange(openPicker === "preset" ? null : "preset")
            }
            onClose={() => onOpenPickerChange(null)}
            widthClassName={pickerWidth("preset")}
            icon={Sparkles}
            label={
              modelPresets.find(
                (preset) => preset.preset_id === selectedPresetId,
              )?.label ??
              modelPresets.find((preset) => preset.key === selectedPresetId)
                ?.label ??
              "Preset"
            }
            selectedValue={selectedPresetId}
            menuTitle="Preset"
            choices={[
              { value: "", label: "Preset" },
              ...modelPresets.map((preset) => ({
                value: preset.preset_id,
                label: preset.label,
              })),
            ]}
            onSelect={(value) =>
              onPresetSelection(value, { preferredModelKey: modelKey })
            }
          />
        ) : null}

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
            resolvedLabel,
            selectedValue,
            choices,
            hasChoices,
          }) => {
            if (!hasChoices && schema.type === "int_range") {
              const min =
                typeof schema.min === "number" ? schema.min : undefined;
              const max =
                typeof schema.max === "number" ? schema.max : undefined;
              const numericValue = Number(resolvedValue ?? min ?? 0);
              return (
                <label
                  key={optionKey}
                  className="flex h-10 w-[calc(50%-0.25rem)] items-center gap-2 rounded-[18px] border border-white/10 bg-white/[0.045] px-3 text-[0.72rem] text-white/78 sm:w-[112px]"
                >
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
                        Number.isFinite(parsed)
                          ? parsed
                          : event.currentTarget.value,
                      );
                    }}
                    className="min-w-0 flex-1 bg-transparent text-right text-white outline-none"
                  />
                </label>
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
                label={displayOptionControlLabel(optionKey, resolvedLabel)}
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
        <div className="flex items-center gap-2">
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
            {generateButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
