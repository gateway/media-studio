"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";

import {
  providerCatalogLabel,
  providerCatalogStatusDetail,
  providerModelCapabilities,
  providerModelFallback,
  providerModelSelectionDetail,
  type SharedProviderCatalogState,
} from "@/lib/llm-provider-models";
import type { MediaEnhancementProviderModel } from "@/lib/types";

import { useGraphProviderModelCatalogContext, type GraphProviderKind } from "./hooks/use-graph-provider-model-catalog";
import type { GraphNodeData } from "./types";
import { graphPromptSavedModelLabel } from "./utils/graph-prompt-provider";

const GRAPH_PROVIDER_KINDS: GraphProviderKind[] = ["openrouter", "codex_local", "local_openai"];

function isGraphProviderKind(value: string): value is GraphProviderKind {
  return GRAPH_PROVIDER_KINDS.includes(value as GraphProviderKind);
}

function fieldBooleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return Boolean(value);
}

export function GraphNodeProviderModelField({
  nodeId,
  field,
  nodeFields,
  value,
  disabled,
  onFieldChange,
  onSetFields,
  className,
}: {
  nodeId: string;
  field: GraphNodeData["definition"]["fields"][number];
  nodeFields: Record<string, unknown>;
  value: unknown;
  disabled?: boolean;
  onFieldChange: GraphNodeData["onFieldChange"];
  onSetFields?: GraphNodeData["onSetFields"];
  className: string;
}) {
  const providerKind = String(nodeFields.provider ?? "").trim();
  const [query, setQuery] = useState("");
  const { catalogs, readiness, refreshProviderCatalog } = useGraphProviderModelCatalogContext();

  if (!isGraphProviderKind(providerKind)) {
    return (
      <input
        className={className}
        type="text"
        value={String(value ?? field.default ?? "")}
        placeholder={field.placeholder ?? ""}
        disabled={disabled}
        onChange={(event) => onFieldChange(nodeId, field.id, event.target.value)}
      />
    );
  }

  const catalogEntry = (catalogs[providerKind] ?? null) as SharedProviderCatalogState | null;
  const providerReady = readiness[providerKind]?.ready ?? false;
  const availableModels = catalogEntry?.availableModels ?? [];
  const selectedModelId = String(value ?? field.default ?? "");
  const selectedModel = availableModels.find((item) => item.id === selectedModelId) ?? null;
  const showSearch = providerKind === "openrouter" || availableModels.length > 12;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = !normalizedQuery
    ? availableModels
    : availableModels.filter((item) => `${item.label} ${item.id}`.toLowerCase().includes(normalizedQuery));
  const fallbackModel =
    selectedModelId && !selectedModel
      ? providerModelFallback({
          providerKind,
          modelId: selectedModelId,
          label: graphPromptSavedModelLabel(nodeFields, providerKind, selectedModelId),
          supportsImages: fieldBooleanValue(nodeFields.provider_supports_images),
        })
      : null;
  const selectedCatalogModel = selectedModel && !filteredModels.some((item) => item.id === selectedModel.id) ? selectedModel : null;
  const modelOptions = [
    ...(fallbackModel ? [fallbackModel] : []),
    ...(selectedCatalogModel ? [selectedCatalogModel] : []),
    ...filteredModels.filter((item) => item.id !== fallbackModel?.id && item.id !== selectedCatalogModel?.id),
  ];

  const selectionDetail = providerModelSelectionDetail(selectedModel, fallbackModel);
  const statusDetail = providerReady
    ? providerCatalogStatusDetail(providerKind, catalogEntry)
    : providerKind === "codex_local"
      ? "Set up Codex in AI Settings to choose a model."
      : providerKind === "openrouter"
        ? "Add OpenRouter in AI Settings to choose a model."
        : "Set up Local OpenAI in AI Settings to choose a model.";

  return (
    <div className="graph-provider-model-picker">
      {showSearch ? (
        <input
          className={`${className} graph-provider-model-search`}
          type="text"
          value={query}
          placeholder={`Search ${providerCatalogLabel(providerKind)} models`}
          disabled={disabled || !providerReady}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      <div className="graph-provider-model-picker-row">
        <select
          className={className}
          value={selectedModelId}
          disabled={disabled || !providerReady}
          onChange={(event) => {
            const nextModelId = event.target.value;
            if (!nextModelId) {
              onSetFields?.(nodeId, {
                model_id: "",
                provider_model_label: "",
                provider_supports_images: null,
                provider_capabilities_json: {},
              });
              if (!onSetFields) onFieldChange(nodeId, field.id, "");
              return;
            }
            const nextModel = availableModels.find((item) => item.id === nextModelId) ?? fallbackModel;
            if (!nextModel) {
              onFieldChange(nodeId, field.id, nextModelId);
              return;
            }
            onSetFields?.(nodeId, {
              model_id: nextModel.id,
              provider_model_label: nextModel.label,
              provider_supports_images: Boolean(nextModel.supports_images),
              provider_capabilities_json: providerModelCapabilities(nextModel),
            });
            if (!onSetFields) onFieldChange(nodeId, field.id, nextModel.id);
          }}
        >
          <option value="">Select a model</option>
          {modelOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="graph-provider-model-refresh nodrag nopan"
          aria-label={`Refresh ${providerCatalogLabel(providerKind)} models`}
          title={`Refresh ${providerCatalogLabel(providerKind)} models`}
          disabled={disabled || !providerReady || catalogEntry?.status === "loading"}
          onClick={() => {
            void refreshProviderCatalog(providerKind, { announce: true });
          }}
        >
          <RefreshCw size={14} className={catalogEntry?.status === "loading" ? "graph-provider-model-refresh-icon-spinning" : undefined} />
        </button>
      </div>
      <small className="graph-node-field-note">{selectionDetail ?? statusDetail}</small>
      {selectionDetail && statusDetail && selectionDetail !== statusDetail ? <small className="graph-node-field-note">{statusDetail}</small> : null}
    </div>
  );
}
