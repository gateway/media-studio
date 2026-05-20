"use client";

import { useLayoutEffect, useRef } from "react";

import { GraphNodeProviderModelField } from "./graph-node-provider-model-field";
import { useGraphProviderModelCatalogContext, type GraphProviderKind } from "./hooks/use-graph-provider-model-catalog";
import type { GraphNodeData } from "./types";
import { graphPromptRuntimeFieldOverride } from "./utils/graph-prompt-provider";
import { graphPromptRecipeFieldOverride, graphPromptRecipeFilteredOptions, graphPromptRecipeOptionLabel, graphPromptRecipeSelectionDefaults } from "./utils/graph-prompt-recipe";

const READY_PROVIDER_KINDS = new Set<GraphProviderKind>(["openrouter", "codex_local", "local_openai"]);

function isGraphProviderKind(value: string): value is GraphProviderKind {
  return READY_PROVIDER_KINDS.has(value as GraphProviderKind);
}

function providerReadinessLabel(providerKind: GraphProviderKind) {
  if (providerKind === "codex_local") return "Set up Codex in AI Settings";
  if (providerKind === "openrouter") return "Add OpenRouter in AI Settings";
  return "Set up Local OpenAI in AI Settings";
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
            model_supports_images: null,
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
  const override = graphPromptRecipeFieldOverride(definition, nodeFields, field);
  const runtimeOverride = graphPromptRuntimeFieldOverride(definition.type, nodeFields, field);
  const placeholder = override?.placeholder ?? runtimeOverride?.placeholder ?? field.placeholder ?? "";

  useLayoutEffect(() => {
    const selection = selectionRef.current;
    const textarea = textareaRef.current;
    if (!selection || !textarea || document.activeElement !== textarea) return;
    const start = Math.min(selection.start, textarea.value.length);
    const end = Math.min(selection.end, textarea.value.length);
    textarea.setSelectionRange(start, end);
  }, [textValue]);

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
  const fieldOverride = graphPromptRecipeFieldOverride(definition, nodeFields, field);
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
    if (field.id === "provider" && (definition.type === "prompt.llm" || definition.type === "prompt.recipe")) {
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
    const options = field.type === "prompt_recipe_picker" ? graphPromptRecipeFilteredOptions(field, nodeFields) : fieldOverride?.options ?? field.options ?? [];
    const emptyLabel = field.type === "prompt_recipe_picker" ? "Select recipe" : field.id === "project_id" ? "No group" : "Auto";
    const showEmptyOption = field.type === "prompt_recipe_picker" || (!field.required && (field.default === undefined || field.default === null || field.default === ""));
    return (
      <select
        className={commonClass}
        value={String(value ?? field.default ?? "")}
        disabled={disabled}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (field.id === "provider" && (definition.type === "prompt.llm" || definition.type === "prompt.recipe")) {
            onSetFields?.(nodeId, {
              provider: nextValue,
              model_id: "",
              provider_model_label: "",
              provider_supports_images: null,
              provider_capabilities_json: {},
              model_supports_images: null,
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
          onFieldChange(nodeId, field.id, nextValue);
        }}
      >
        {showEmptyOption ? <option value="">{emptyLabel}</option> : null}
        {options.map((option) => {
          const optionValue = typeof option === "object" && option !== null && "value" in option ? (option as { value: unknown }).value : option;
          const optionLabel = field.type === "prompt_recipe_picker" ? graphPromptRecipeOptionLabel(option, String(nodeFields.recipe_category ?? "all")) : typeof option === "object" && option !== null && "label" in option ? (option as { label: unknown }).label : optionValue;
          return (
            <option key={String(optionValue)} value={String(optionValue)}>
              {String(optionLabel)}
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
  const numeric = field.type === "integer" || field.type === "float" || field.type === "number" || field.type === "int_range" || field.type === "float_range";
  return (
    <input
      className={commonClass}
      type={field.type === "color" ? "color" : numeric ? "number" : "text"}
      value={String(value ?? field.default ?? "")}
      placeholder={fieldOverride?.placeholder ?? runtimeOverride?.placeholder ?? field.placeholder ?? ""}
      min={field.min ?? undefined}
      max={field.max ?? undefined}
      disabled={disabled}
      onChange={(event) => onFieldChange(nodeId, field.id, event.target.value)}
    />
  );
}
