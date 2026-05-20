// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphNodeFieldControl } from "./graph-node-field";
import { GraphProviderModelCatalogProvider } from "./hooks/use-graph-provider-model-catalog";
import type { GraphNodeDefinition } from "./types";

const promptDefinition: GraphNodeDefinition = {
  type: "prompt.llm",
  title: "LLM Prompt",
  description: "LLM prompt node",
  category: "Prompt",
  source: { kind: "external_llm" },
  execution: {},
  limits: {},
  ui: {},
  ports: { inputs: [], outputs: [] },
  fields: [
    {
      id: "provider",
      label: "Provider",
      type: "select",
      default: "studio_default",
      options: [
        { label: "Studio default", value: "studio_default" },
        { label: "Codex Local", value: "codex_local" },
        { label: "OpenRouter", value: "openrouter" },
      ],
    },
    {
      id: "model_id",
      label: "Model",
      type: "provider_model_picker",
      visible_if: { field: "provider", not_equals: "studio_default" },
    },
  ],
};

function renderWithCatalog(control: ReactNode, overrides?: { refreshProviderCatalog?: ReturnType<typeof vi.fn> }) {
  const refreshProviderCatalog = overrides?.refreshProviderCatalog ?? vi.fn().mockResolvedValue(undefined);
  render(
    <GraphProviderModelCatalogProvider
      value={{
        catalogs: {
          codex_local: {
            status: "ready",
            availableModels: [
              { id: "gpt-5.4", label: "GPT-5.4", provider: "codex_local", supports_images: true, input_modalities: ["text", "image"] },
              { id: "gpt-5.5", label: "GPT-5.5", provider: "codex_local", supports_images: true, input_modalities: ["text", "image"] },
            ],
            credentialSource: "codex_local_login",
            error: null,
            fetchedAt: Date.now(),
          },
          openrouter: {
            status: "ready",
            availableModels: Array.from({ length: 14 }, (_, index) => ({
              id: `openrouter/model-${index + 1}`,
              label: `OpenRouter Model ${index + 1}`,
              provider: "openrouter",
              supports_images: index % 2 === 0,
              input_modalities: index % 2 === 0 ? ["text", "image"] : ["text"],
            })),
            credentialSource: "stored",
            error: null,
            fetchedAt: Date.now(),
          },
        },
        readiness: {
          codex_local: { configured: true, ready: true },
          openrouter: { configured: true, ready: true },
          local_openai: { configured: false, ready: false },
        },
        refreshProviderCatalog,
      }}
    >
      {control}
    </GraphProviderModelCatalogProvider>,
  );
  return { refreshProviderCatalog };
}

afterEach(() => {
  cleanup();
});

describe("GraphNodeFieldControl", () => {
  it("renders the provider-backed model picker and persists selected capability metadata", () => {
    const onFieldChange = vi.fn();
    const onSetFields = vi.fn();

    renderWithCatalog(
      <GraphNodeFieldControl
        nodeId="node-1"
        definition={promptDefinition}
        nodeFields={{ provider: "codex_local" }}
        field={promptDefinition.fields[1]}
        value="gpt-5.4"
        onFieldChange={onFieldChange}
        onSetFields={onSetFields}
      />,
    );

    const select = screen.getByRole("combobox");
    expect((select as HTMLSelectElement).value).toBe("gpt-5.4");
    expect(screen.getByText("Selected model accepts text and image input.")).toBeTruthy();

    fireEvent.change(select, { target: { value: "gpt-5.5" } });

    expect(onSetFields).toHaveBeenCalledWith(
      "node-1",
      expect.objectContaining({
        model_id: "gpt-5.5",
        provider_model_label: "GPT-5.5",
        provider_supports_images: true,
        provider_capabilities_json: expect.objectContaining({
          model_id: "gpt-5.5",
          supports_images: true,
          input_modalities: ["text", "image"],
        }),
      }),
    );
  });

  it("renders a fallback option for saved models missing from the current catalog", () => {
    renderWithCatalog(
      <GraphNodeFieldControl
        nodeId="node-1"
        definition={promptDefinition}
        nodeFields={{ provider: "codex_local", provider_model_label: "Legacy Vision", provider_supports_images: true }}
        field={promptDefinition.fields[1]}
        value="legacy/vision-model"
        onFieldChange={vi.fn()}
        onSetFields={vi.fn()}
      />,
    );

    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("legacy/vision-model");
    expect(screen.getByRole("option", { name: "Legacy Vision" })).toBeTruthy();
    expect(screen.getByText("Saved model is not in the current provider catalog. Refresh to confirm it still exists.")).toBeTruthy();
  });

  it("does not reuse a stale fallback label from another provider", () => {
    renderWithCatalog(
      <GraphNodeFieldControl
        nodeId="node-1"
        definition={promptDefinition}
        nodeFields={{
          provider: "codex_local",
          provider_model_label: "Qwen 3.6",
          provider_supports_images: true,
          provider_capabilities_json: { provider: "openrouter", model_id: "qwen/qwen3.6", model_label: "Qwen 3.6" },
        }}
        field={promptDefinition.fields[1]}
        value="qwen/qwen3.6"
        onFieldChange={vi.fn()}
        onSetFields={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "Saved model (qwen/qwen3.6)" })).toBeTruthy();
  });

  it("clears stale model metadata when the provider changes", () => {
    const onSetFields = vi.fn();

    renderWithCatalog(
      <GraphNodeFieldControl
        nodeId="node-1"
        definition={promptDefinition}
        nodeFields={{
          provider: "codex_local",
          model_id: "gpt-5.4",
          provider_model_label: "GPT-5.4",
          provider_supports_images: true,
          provider_capabilities_json: { supports_images: true, input_modalities: ["text", "image"] },
        }}
        field={promptDefinition.fields[0]}
        value="codex_local"
        onFieldChange={vi.fn()}
        onSetFields={onSetFields}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "openrouter" } });

    expect(onSetFields).toHaveBeenCalledWith("node-1", {
      provider: "openrouter",
      model_id: "",
      provider_model_label: "",
      provider_supports_images: null,
      provider_capabilities_json: {},
      model_supports_images: null,
    });
  });

  it("offers search and refresh affordances for large provider catalogs", () => {
    const refreshProviderCatalog = vi.fn().mockResolvedValue(undefined);

    renderWithCatalog(
      <GraphNodeFieldControl
        nodeId="node-1"
        definition={promptDefinition}
        nodeFields={{ provider: "openrouter" }}
        field={promptDefinition.fields[1]}
        value=""
        onFieldChange={vi.fn()}
        onSetFields={vi.fn()}
      />,
      { refreshProviderCatalog },
    );

    fireEvent.change(screen.getByPlaceholderText("Search OpenRouter models"), { target: { value: "Model 12" } });
    expect(screen.getByRole("option", { name: "OpenRouter Model 12" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Refresh OpenRouter models" }));
    expect(refreshProviderCatalog).toHaveBeenCalledWith("openrouter", { announce: true });
  });

  it("disables unready providers and explains the setup handoff", () => {
    renderWithCatalog(
      <GraphNodeFieldControl
        nodeId="node-1"
        definition={promptDefinition}
        nodeFields={{ provider: "studio_default" }}
        field={{
          ...promptDefinition.fields[0],
          options: [
            { label: "Studio default", value: "studio_default" },
            { label: "Local OpenAI", value: "local_openai" },
          ],
        }}
        value="studio_default"
        onFieldChange={vi.fn()}
        onSetFields={vi.fn()}
      />,
    );

    const option = screen.getByRole("option", { name: "Local OpenAI (Not set up)" }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
  });
});
