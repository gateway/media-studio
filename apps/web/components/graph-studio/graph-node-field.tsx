"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { GraphMarkdownNoteField } from "./graph-markdown-note";
import { GraphNodeProviderModelField } from "./graph-node-provider-model-field";
import { useGraphProviderModelCatalogContext, type GraphProviderKind } from "./hooks/use-graph-provider-model-catalog";
import type { GraphNodeData } from "./types";
import {
  graphMediaPresetById,
  graphMediaPresetFieldOverride,
  graphMediaPresetSelectionDefaults,
  graphMediaPresetSelectionPayload,
  type MediaPresetCatalogItem,
} from "./utils/graph-media-preset";
import { graphPromptRuntimeFieldOverride } from "./utils/graph-prompt-provider";
import { graphPromptRecipeFieldOverride, graphPromptRecipeFilteredOptions, graphPromptRecipeOptionLabel, graphPromptRecipeSelectionDefaults } from "./utils/graph-prompt-recipe";

const READY_PROVIDER_KINDS = new Set<GraphProviderKind>(["openrouter", "codex_local", "local_openai"]);
const LARGE_GRAPH_PICKER_OPTION_THRESHOLD = 30;
const LARGE_GRAPH_PICKER_RESULT_LIMIT = 40;

type GraphPickerOption = {
  label: string;
  value: string;
};

type GraphPresetPickerOption = GraphPickerOption & {
  preset: MediaPresetCatalogItem;
};

function isGraphProviderKind(value: string): value is GraphProviderKind {
  return READY_PROVIDER_KINDS.has(value as GraphProviderKind);
}

function providerReadinessLabel(providerKind: GraphProviderKind) {
  if (providerKind === "codex_local") return "Set up Codex in AI Settings";
  if (providerKind === "openrouter") return "Add OpenRouter in AI Settings";
  return "Set up Local OpenAI in AI Settings";
}

function optionValue(option: unknown) {
  return typeof option === "object" && option !== null && "value" in option ? String((option as { value: unknown }).value) : String(option);
}

function optionLabel(option: unknown, fallbackLabel?: string) {
  if (typeof option === "object" && option !== null && "label" in option) return String((option as { label: unknown }).label);
  return fallbackLabel ?? optionValue(option);
}

function graphPickerResultSummary(total: number, shown: number, query: string) {
  if (!total) return "No matches.";
  if (shown >= total) return `${total} option${total === 1 ? "" : "s"}.`;
  return query.trim() ? `Showing ${shown} of ${total} matches.` : `Showing first ${shown} of ${total}. Search to narrow.`;
}

function GraphLargeOptionPicker({
  field,
  value,
  options,
  emptyLabel,
  disabled,
  onSelect,
}: {
  field: GraphNodeData["definition"]["fields"][number];
  value: string;
  options: GraphPickerOption[];
  emptyLabel: string;
  disabled?: boolean;
  onSelect: (nextValue: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const selectedLabel = selectedOption?.label ?? (value ? value : emptyLabel);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, options]);
  const visibleOptions = filteredOptions.slice(0, LARGE_GRAPH_PICKER_RESULT_LIMIT);
  const searchLabel = `Search ${field.label}`;

  return (
    <div className="graph-node-large-picker nodrag">
      <button
        type="button"
        className="graph-node-large-picker-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <span>{selectedLabel}</span>
        <small>{options.length} option{options.length === 1 ? "" : "s"}</small>
      </button>
      {open ? (
        <div className="graph-node-large-picker-panel">
          <input
            className="graph-node-large-picker-search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="graph-node-large-picker-results" role="listbox" aria-label={`${field.label} options`}>
            {visibleOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className="graph-node-large-picker-option"
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(option.value);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {option.label}
              </button>
            ))}
            {!visibleOptions.length ? <div className="graph-node-large-picker-empty">No matches.</div> : null}
          </div>
          <small className="graph-node-field-note">{graphPickerResultSummary(filteredOptions.length, visibleOptions.length, query)}</small>
        </div>
      ) : null}
    </div>
  );
}

async function fetchGraphPresetSearch(query: string): Promise<GraphPresetPickerOption[]> {
  const params = new URLSearchParams({ limit: "40", status: "active", view: "summary" });
  if (query.trim()) params.set("q", query.trim());
  const response = await fetch(`/api/control/media-presets?${params.toString()}`);
  if (!response.ok) throw new Error("Unable to search presets.");
  const payload = (await response.json()) as { presets?: unknown[]; ok?: boolean };
  if (payload.ok === false) throw new Error("Unable to search presets.");
  return (payload.presets ?? [])
    .map((item) => graphMediaPresetSelectionPayload(item))
    .filter((preset): preset is MediaPresetCatalogItem => Boolean(preset))
    .map((preset) => ({ value: preset.preset_id, label: preset.label, preset }));
}

async function fetchGraphPresetDetail(presetId: string): Promise<MediaPresetCatalogItem | null> {
  if (!presetId) return null;
  const response = await fetch(`/api/control/media-presets/${encodeURIComponent(presetId)}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { preset?: unknown; ok?: boolean };
  if (payload.ok === false) return null;
  return graphMediaPresetSelectionPayload(payload.preset);
}

function GraphPresetLazyPicker({
  nodeId,
  definition,
  nodeFields,
  field,
  value,
  disabled,
  onFieldChange,
  onSetFields,
}: {
  nodeId: string;
  definition: GraphNodeData["definition"];
  nodeFields: Record<string, unknown>;
  field: GraphNodeData["definition"]["fields"][number];
  value: unknown;
  disabled?: boolean;
  onFieldChange: GraphNodeData["onFieldChange"];
  onSetFields?: GraphNodeData["onSetFields"];
}) {
  const selectedValue = String(value ?? field.default ?? "");
  const selectedPreset = graphMediaPresetById(definition, selectedValue, nodeFields);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<GraphPresetPickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectingPresetId, setSelectingPresetId] = useState<string | null>(null);
  const selectedLabel = selectedPreset?.label ?? (selectedValue ? selectedValue : "Select preset");

  useEffect(() => {
    if (!selectedValue || selectedPreset || !onSetFields) return;
    let cancelled = false;
    void fetchGraphPresetDetail(selectedValue).then((preset) => {
      if (cancelled || !preset) return;
      onSetFields(nodeId, { __preset_catalog_item_json: preset });
    });
    return () => {
      cancelled = true;
    };
  }, [nodeId, onSetFields, selectedPreset, selectedValue]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void fetchGraphPresetSearch(query)
        .then((items) => {
          if (!cancelled) setOptions(items);
        })
        .catch((searchError: unknown) => {
          if (!cancelled) setError(searchError instanceof Error ? searchError.message : "Unable to search presets.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const selectPreset = async (preset: MediaPresetCatalogItem) => {
    const detail = await fetchGraphPresetDetail(preset.preset_id).catch(() => null);
    if (!detail) {
      setError("Unable to load preset details.");
      return;
    }
    const nextFields: Record<string, unknown> = {
      preset_id: detail.preset_id,
      __preset_catalog_item_json: detail,
    };
    const defaults = graphMediaPresetSelectionDefaults(definition, detail.preset_id, {
      ...nodeFields,
      __preset_catalog_item_json: detail,
    });
    if (defaults) Object.assign(nextFields, defaults);
    if (onSetFields) {
      onSetFields(nodeId, nextFields);
    } else {
      onFieldChange(nodeId, field.id, detail.preset_id);
    }
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="graph-node-large-picker nodrag">
      <button
        type="button"
        className="graph-node-large-picker-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <span>{selectedLabel}</span>
        <small>{selectedPreset ? "Selected preset" : "Search presets"}</small>
      </button>
      {open ? (
        <div className="graph-node-large-picker-panel">
          <input
            className="graph-node-large-picker-search"
            aria-label={`Search ${field.label}`}
            placeholder={`Search ${field.label}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="graph-node-large-picker-results" role="listbox" aria-label={`${field.label} options`}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === selectedValue}
                className="graph-node-large-picker-option"
                disabled={selectingPresetId === option.value}
                onClick={(event) => {
                  event.preventDefault();
                  setSelectingPresetId(option.value);
                  setError(null);
                  void selectPreset(option.preset).finally(() => setSelectingPresetId(null));
                }}
              >
                {selectingPresetId === option.value ? "Loading..." : option.label}
              </button>
            ))}
            {!options.length ? (
              <div className="graph-node-large-picker-empty">
                {loading ? "Loading presets..." : error ?? "Search to find a preset."}
              </div>
            ) : null}
          </div>
          <small className="graph-node-field-note">{loading ? "Searching..." : graphPickerResultSummary(options.length, options.length, query)}</small>
        </div>
      ) : null}
    </div>
  );
}

function GraphPromptProviderSelect({
  nodeId,
  definition,
  nodeFields,
  field,
  value,
  disabled,
  onFieldChange,
  onSetFields,
  className,
}: {
  nodeId: string;
  definition: GraphNodeData["definition"];
  nodeFields: Record<string, unknown>;
  field: GraphNodeData["definition"]["fields"][number];
  value: unknown;
  disabled?: boolean;
  onFieldChange: GraphNodeData["onFieldChange"];
  onSetFields?: GraphNodeData["onSetFields"];
  className: string;
}) {
  const { readiness } = useGraphProviderModelCatalogContext();
  const selectedValue = String(value ?? field.default ?? "");
  const selectedProviderKind = isGraphProviderKind(selectedValue) ? selectedValue : null;
  const selectedProviderReady = selectedProviderKind ? readiness[selectedProviderKind]?.ready ?? false : true;
  const selectedProviderConfigured = selectedProviderKind ? readiness[selectedProviderKind]?.configured ?? false : true;

  return (
    <div className="graph-provider-model-picker">
      <select
        className={className}
        value={selectedValue}
        disabled={disabled}
        onChange={(event) => {
          const nextValue = event.target.value;
          onSetFields?.(nodeId, {
            provider: nextValue,
            model_id: "",
            provider_model_label: "",
            provider_supports_images: null,
            provider_capabilities_json: {},
          });
          if (!onSetFields) onFieldChange(nodeId, field.id, nextValue);
        }}
      >
        {(field.options ?? []).map((option) => {
          const optionValue = typeof option === "object" && option !== null && "value" in option ? String((option as { value: unknown }).value) : String(option);
          const optionLabel = typeof option === "object" && option !== null && "label" in option ? String((option as { label: unknown }).label) : optionValue;
          if (!isGraphProviderKind(optionValue)) {
            return (
              <option key={optionValue} value={optionValue}>
                {optionLabel}
              </option>
            );
          }
          const providerReadiness = readiness[optionValue];
          const ready = providerReadiness?.ready ?? false;
          const configured = providerReadiness?.configured ?? false;
          const isSelectedUnavailable = selectedValue === optionValue && !ready;
          return (
            <option
              key={optionValue}
              value={optionValue}
              disabled={!ready && !isSelectedUnavailable}
            >
              {ready ? optionLabel : `${optionLabel} (${configured ? "Unavailable" : "Not set up"})`}
            </option>
          );
        })}
      </select>
      {selectedProviderKind && !selectedProviderReady ? (
        <small className="graph-node-field-note">
          {providerReadinessLabel(selectedProviderKind)}. Current selection stays visible so older workflows still load.
        </small>
      ) : selectedProviderKind && !selectedProviderConfigured ? (
        <small className="graph-node-field-note">{providerReadinessLabel(selectedProviderKind)}.</small>
      ) : null}
    </div>
  );
}

function GraphNodeTextareaField({
  nodeId,
  field,
  definition,
  nodeFields,
  value,
  disabled,
  onFieldChange,
  className,
}: {
  nodeId: string;
  field: GraphNodeData["definition"]["fields"][number];
  definition: GraphNodeData["definition"];
  nodeFields: Record<string, unknown>;
  value: unknown;
  disabled?: boolean;
  onFieldChange: GraphNodeData["onFieldChange"];
  className: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const textValue = String(value ?? "");
  const override = graphMediaPresetFieldOverride(definition, nodeFields, field) ?? graphPromptRecipeFieldOverride(definition, nodeFields, field);
  const runtimeOverride = graphPromptRuntimeFieldOverride(definition.type, nodeFields, field);
  const placeholder = override?.placeholder ?? runtimeOverride?.placeholder ?? field.placeholder ?? "";
  const markdownPreviewField = typeof definition.ui?.markdown_preview_field === "string" ? definition.ui.markdown_preview_field : null;

  useLayoutEffect(() => {
    const selection = selectionRef.current;
    const textarea = textareaRef.current;
    if (!selection || !textarea || document.activeElement !== textarea) return;
    const start = Math.min(selection.start, textarea.value.length);
    const end = Math.min(selection.end, textarea.value.length);
    textarea.setSelectionRange(start, end);
  }, [textValue]);

  if (markdownPreviewField === field.id) {
    return (
      <GraphMarkdownNoteField
        value={textValue}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        onChange={(nextValue) => onFieldChange(nodeId, field.id, nextValue)}
      />
    );
  }

  return (
    <textarea
      ref={textareaRef}
      className={className}
      value={textValue}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => {
        selectionRef.current = {
          start: event.currentTarget.selectionStart,
          end: event.currentTarget.selectionEnd,
        };
        onFieldChange(nodeId, field.id, event.currentTarget.value);
      }}
    />
  );
}

export function GraphNodeFieldControl({
  nodeId,
  definition,
  nodeFields,
  field,
  value,
  disabled,
  onFieldChange,
  onSetFields,
}: {
  nodeId: string;
  definition: GraphNodeData["definition"];
  nodeFields: Record<string, unknown>;
  field: GraphNodeData["definition"]["fields"][number];
  value: unknown;
  disabled?: boolean;
  onFieldChange: GraphNodeData["onFieldChange"];
  onSetFields?: GraphNodeData["onSetFields"];
}) {
  if (field.hidden) return null;
  const commonClass = "graph-node-field-control nodrag";
  const fieldOverride = graphMediaPresetFieldOverride(definition, nodeFields, field) ?? graphPromptRecipeFieldOverride(definition, nodeFields, field);
  const runtimeOverride = graphPromptRuntimeFieldOverride(definition.type, nodeFields, field);
  if (field.type === "textarea") {
    return <GraphNodeTextareaField nodeId={nodeId} definition={definition} nodeFields={nodeFields} field={field} value={value} disabled={disabled} onFieldChange={onFieldChange} className={commonClass} />;
  }
  if (field.type === "provider_model_picker") {
    return (
      <GraphNodeProviderModelField
        nodeId={nodeId}
        field={field}
        nodeFields={nodeFields}
        value={value}
        disabled={disabled}
        onFieldChange={onFieldChange}
        onSetFields={onSetFields}
        className={commonClass}
      />
    );
  }
  if (
    field.type === "select" ||
    field.type === "enum" ||
    field.type === "preset_picker" ||
    field.type === "prompt_recipe_picker" ||
    field.type === "asset_picker" ||
    field.type === "reference_media_picker"
  ) {
    if (field.id === "provider" && (definition.type === "prompt.llm" || definition.type === "prompt.recipe" || definition.type === "prompt.image_analyzer")) {
      return (
        <GraphPromptProviderSelect
          nodeId={nodeId}
          definition={definition}
          nodeFields={nodeFields}
          field={field}
          value={value}
          disabled={disabled}
          onFieldChange={onFieldChange}
          onSetFields={onSetFields}
          className={commonClass}
        />
      );
    }
    if (field.type === "preset_picker" && definition.source?.lazy_catalog) {
      return (
        <GraphPresetLazyPicker
          nodeId={nodeId}
          definition={definition}
          nodeFields={nodeFields}
          field={field}
          value={value}
          disabled={disabled}
          onFieldChange={onFieldChange}
          onSetFields={onSetFields}
        />
      );
    }
    const options = field.type === "prompt_recipe_picker" ? graphPromptRecipeFilteredOptions(field, nodeFields) : fieldOverride?.options ?? field.options ?? [];
    const emptyLabel = field.type === "prompt_recipe_picker" ? "Select recipe" : field.type === "preset_picker" ? "Select preset" : field.id === "project_id" ? "No group" : "Auto";
    const showEmptyOption = field.type === "prompt_recipe_picker" || field.type === "preset_picker" || (!field.required && (field.default === undefined || field.default === null || field.default === ""));
    const selectedValue = String(value ?? field.default ?? "");
    const handlePickerChange = (nextValue: string) => {
      if (field.id === "provider" && (definition.type === "prompt.llm" || definition.type === "prompt.recipe" || definition.type === "prompt.image_analyzer")) {
        onSetFields?.(nodeId, {
          provider: nextValue,
          model_id: "",
          provider_model_label: "",
          provider_supports_images: null,
          provider_capabilities_json: {},
        });
        if (!onSetFields) onFieldChange(nodeId, field.id, nextValue);
        return;
      }
      if (field.id === "recipe_category") {
        onFieldChange(nodeId, field.id, nextValue);
        const currentRecipe = String(nodeFields.recipe_id ?? "");
        const recipePickerField = definition.fields.find((candidate) => candidate.id === "recipe_id");
        const currentRecipeOption = (recipePickerField?.options ?? []).find(
          (option) => option && typeof option === "object" && "value" in option && String((option as { value: unknown }).value) === currentRecipe,
        ) as Record<string, unknown> | undefined;
        if (currentRecipe && nextValue !== "all" && String(currentRecipeOption?.category ?? "") !== nextValue) {
          onFieldChange(nodeId, "recipe_id", "");
        }
        return;
      }
      if (field.id === "recipe_id") {
        onFieldChange(nodeId, field.id, nextValue);
        const defaults = graphPromptRecipeSelectionDefaults(definition, nextValue);
        if (defaults) {
          onFieldChange(nodeId, "recipe_category", String(defaults.recipe_category ?? "all"));
          for (const [defaultFieldId, defaultValue] of Object.entries(defaults)) {
            if (defaultFieldId === "recipe_category") continue;
            const currentValue = nodeFields[defaultFieldId];
            if (currentValue === undefined || currentValue === null || currentValue === "") {
              onFieldChange(nodeId, defaultFieldId, defaultValue);
            }
          }
        }
        return;
      }
      if (field.id === "preset_id") {
        onFieldChange(nodeId, field.id, nextValue);
        const defaults = graphMediaPresetSelectionDefaults(definition, nextValue);
        if (defaults) {
          for (const [defaultFieldId, defaultValue] of Object.entries(defaults)) {
            onFieldChange(nodeId, defaultFieldId, defaultValue);
          }
        }
        return;
      }
      onFieldChange(nodeId, field.id, nextValue);
    };
    const pickerOptions = options.map((option) => ({
      value: optionValue(option),
      label: field.type === "prompt_recipe_picker" ? graphPromptRecipeOptionLabel(option, String(nodeFields.recipe_category ?? "all")) : optionLabel(option),
    }));
    if ((field.type === "preset_picker" || field.type === "prompt_recipe_picker" || field.type === "asset_picker" || field.type === "reference_media_picker") && pickerOptions.length > LARGE_GRAPH_PICKER_OPTION_THRESHOLD) {
      const optionsWithEmpty = showEmptyOption ? [{ value: "", label: emptyLabel }, ...pickerOptions] : pickerOptions;
      return (
        <GraphLargeOptionPicker
          field={field}
          value={selectedValue}
          options={optionsWithEmpty}
          emptyLabel={emptyLabel}
          disabled={disabled}
          onSelect={handlePickerChange}
        />
      );
    }
    return (
      <select
        className={commonClass}
        value={selectedValue}
        disabled={disabled}
        onChange={(event) => handlePickerChange(event.target.value)}
      >
        {showEmptyOption ? <option value="">{emptyLabel}</option> : null}
        {pickerOptions.map((option) => {
          return (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          );
        })}
      </select>
    );
  }
  if (field.type === "boolean" || field.type === "bool") {
    const booleanValue = Boolean(value ?? field.default ?? false);
    return (
      <select
        className={commonClass}
        value={booleanValue ? "true" : "false"}
        disabled={disabled}
        onChange={(event) => onFieldChange(nodeId, field.id, event.target.value === "true")}
      >
        <option value="false">Off</option>
        <option value="true">On</option>
      </select>
    );
  }
  const numeric = field.type === "integer" || field.type === "float" || field.type === "number" || field.type === "int_range" || field.type === "float_range" || field.type === "number_range";
  return (
    <input
      className={commonClass}
      type={field.type === "color" ? "color" : numeric ? "number" : "text"}
      value={String(value ?? field.default ?? "")}
      placeholder={fieldOverride?.placeholder ?? runtimeOverride?.placeholder ?? field.placeholder ?? ""}
      min={field.min ?? undefined}
      max={field.max ?? undefined}
      disabled={disabled}
      onChange={(event) => {
        if (!numeric) {
          onFieldChange(nodeId, field.id, event.target.value);
          return;
        }
        const rawValue = event.target.value;
        onFieldChange(nodeId, field.id, rawValue === "" ? "" : Number(rawValue));
      }}
    />
  );
}
