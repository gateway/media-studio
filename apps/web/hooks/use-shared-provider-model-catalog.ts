"use client";

import { useCallback, useRef, useState } from "react";

import { probePromptRecipeDraftingProviderRequest } from "@/lib/media-model-admin";
import type { SharedLlmProviderKind } from "@/lib/llm-provider-metadata";
import type { SharedProviderCatalogState } from "@/lib/llm-provider-models";
import { recordStudioRuntimeMetric } from "@/lib/studio-runtime-metrics";

type ProviderCatalogProbeResult = {
  ok: boolean;
  error?: string | null;
  credentialSource: string | null;
  selectedModel: import("@/lib/types").MediaEnhancementProviderModel | null;
  availableModels: import("@/lib/types").MediaEnhancementProviderModel[];
};

type ProbeProviderCatalogRequest = (payload: {
  provider_kind: SharedLlmProviderKind;
  provider_model_id: string | null;
  provider_base_url: string | null;
  require_images: boolean;
}) => Promise<ProviderCatalogProbeResult>;

type LoadProviderCatalogOptions = {
  selectedModelId?: string | null;
  providerBaseUrl?: string | null;
  requireImages?: boolean;
  force?: boolean;
  announce?: boolean;
};

type LoadProviderCatalogResult =
  | {
      ok: true;
      availableModels: import("@/lib/types").MediaEnhancementProviderModel[];
      selectedModel: import("@/lib/types").MediaEnhancementProviderModel | null;
      credentialSource: string | null;
    }
  | {
      ok: false;
      error: string;
      availableModels: import("@/lib/types").MediaEnhancementProviderModel[];
      selectedModel: null;
      credentialSource: string | null;
    };

const DEFAULT_PROVIDER_CATALOG_TTL_MS = 5 * 60 * 1000;
const sharedCatalogCache: Partial<Record<SharedLlmProviderKind, CatalogEntry>> = {};
const sharedCatalogInFlight = new Map<string, Promise<LoadProviderCatalogResult>>();

export function __resetSharedProviderModelCatalogCacheForTests() {
  for (const providerKind of Object.keys(sharedCatalogCache) as SharedLlmProviderKind[]) {
    delete sharedCatalogCache[providerKind];
  }
  sharedCatalogInFlight.clear();
}

function requestSignature(providerKind: SharedLlmProviderKind, options: LoadProviderCatalogOptions) {
  return JSON.stringify({
    providerKind,
    providerBaseUrl: options.providerBaseUrl ?? null,
    requireImages: Boolean(options.requireImages),
  });
}

type CatalogEntry = SharedProviderCatalogState & {
  requestSignature: string | null;
};

export function useSharedProviderModelCatalog({
  ttlMs = DEFAULT_PROVIDER_CATALOG_TTL_MS,
  probeRequest = probePromptRecipeDraftingProviderRequest,
  appendConsole,
}: {
  ttlMs?: number;
  probeRequest?: ProbeProviderCatalogRequest;
  appendConsole?: (line: string) => void;
} = {}) {
  const [catalogs, setCatalogs] = useState<Partial<Record<SharedLlmProviderKind, CatalogEntry>>>(() => ({ ...sharedCatalogCache }));
  const catalogsRef = useRef(catalogs);

  const updateCatalogEntry = useCallback((providerKind: SharedLlmProviderKind, entry: CatalogEntry) => {
    sharedCatalogCache[providerKind] = entry;
    setCatalogs((previous) => {
      const next = {
        ...previous,
        [providerKind]: entry,
      };
      catalogsRef.current = next;
      return next;
    });
  }, []);

  const loadProviderCatalog = useCallback(
    async (
      providerKind: SharedLlmProviderKind,
      options: LoadProviderCatalogOptions = {},
    ): Promise<LoadProviderCatalogResult> => {
      const current = sharedCatalogCache[providerKind] ?? catalogsRef.current[providerKind];
      const nextRequestSignature = requestSignature(providerKind, options);
      const freshEnough =
        current?.status === "ready" &&
        current.fetchedAt != null &&
        current.requestSignature === nextRequestSignature &&
        Date.now() - current.fetchedAt < ttlMs;
      if (!options.force && freshEnough) {
        recordStudioRuntimeMetric(`providerCatalog.cacheHit.${providerKind}`);
        return {
          ok: true as const,
          availableModels: current.availableModels,
          selectedModel:
            (options.selectedModelId
              ? current.availableModels.find((item) => item.id === options.selectedModelId) ?? null
              : current.availableModels[0] ?? null),
          credentialSource: current.credentialSource,
        };
      }
      const existing = sharedCatalogInFlight.get(nextRequestSignature);
      if (existing && !options.force) {
        recordStudioRuntimeMetric(`providerCatalog.inFlightHit.${providerKind}`);
        const result = await existing;
        const cached = sharedCatalogCache[providerKind];
        if (cached) {
          updateCatalogEntry(providerKind, cached);
        }
        return result;
      }
      const promise = (async () => {
        const previousEntry = sharedCatalogCache[providerKind] ?? catalogsRef.current[providerKind];
        updateCatalogEntry(providerKind, {
          status: "loading",
          availableModels: previousEntry?.availableModels ?? [],
          credentialSource: previousEntry?.credentialSource ?? null,
          error: null,
          fetchedAt: previousEntry?.fetchedAt ?? null,
          requestSignature: nextRequestSignature,
        });
        try {
          recordStudioRuntimeMetric(`providerCatalog.networkRequest.${providerKind}`);
          const result = await probeRequest({
            provider_kind: providerKind,
            provider_model_id: options.selectedModelId ?? null,
            provider_base_url: options.providerBaseUrl ?? null,
            require_images: Boolean(options.requireImages),
          });
          if (!result.ok) {
            throw new Error(result.error ?? "Unable to load provider models.");
          }
          updateCatalogEntry(providerKind, {
            status: "ready",
            availableModels: result.availableModels,
            credentialSource: result.credentialSource ?? null,
            error: null,
            fetchedAt: Date.now(),
            requestSignature: nextRequestSignature,
          });
          if (options.announce) {
            appendConsole?.(`Loaded ${result.availableModels.length} ${providerKind.replaceAll("_", " ")} model(s).`);
          }
          return {
            ok: true as const,
            availableModels: result.availableModels,
            selectedModel: result.selectedModel ?? null,
            credentialSource: result.credentialSource ?? null,
          };
        } catch (error) {
          recordStudioRuntimeMetric(`providerCatalog.networkError.${providerKind}`);
          const message = error instanceof Error ? error.message : "Unable to load provider models.";
          const previousEntry = sharedCatalogCache[providerKind] ?? catalogsRef.current[providerKind];
          updateCatalogEntry(providerKind, {
            status: "error",
            availableModels: previousEntry?.availableModels ?? [],
            credentialSource: previousEntry?.credentialSource ?? null,
            error: message,
            fetchedAt: previousEntry?.fetchedAt ?? null,
            requestSignature: nextRequestSignature,
          });
          if (options.announce || current?.error !== message) {
            appendConsole?.(`Failed to load ${providerKind.replaceAll("_", " ")} models: ${message}`);
          }
          return {
            ok: false as const,
            error: message,
            availableModels: current?.availableModels ?? [],
            selectedModel: null,
            credentialSource: current?.credentialSource ?? null,
          };
        } finally {
          sharedCatalogInFlight.delete(nextRequestSignature);
        }
      })();
      sharedCatalogInFlight.set(nextRequestSignature, promise);
      return promise;
    },
    [appendConsole, probeRequest, ttlMs, updateCatalogEntry],
  );

  return {
    catalogs,
    loadProviderCatalog,
  };
}
