"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { useSharedProviderModelCatalog } from "@/hooks/use-shared-provider-model-catalog";
import { providerReadinessFromHealth } from "@/lib/llm-provider-health";
import { probeSharedProviderCatalogRequest } from "@/lib/media-model-admin";
import type { SharedProviderCatalogState } from "@/lib/llm-provider-models";
import type { ControlApiHealthData } from "@/lib/types";

import type { StudioNode } from "../types";

const GRAPH_PROVIDER_CATALOG_TTL_MS = 5 * 60 * 1000;
const GRAPH_PROVIDER_READINESS_TTL_MS = 60 * 1000;
const GRAPH_PROVIDER_KINDS = ["openrouter", "codex_local", "local_openai"] as const;

export type GraphProviderKind = (typeof GRAPH_PROVIDER_KINDS)[number];

export type GraphProviderCatalogEntry = SharedProviderCatalogState;
export type GraphProviderReadinessEntry = {
  configured: boolean;
  ready: boolean;
};

type GraphProviderModelCatalogContextValue = {
  catalogs: Partial<Record<GraphProviderKind, GraphProviderCatalogEntry>>;
  readiness: Partial<Record<GraphProviderKind, GraphProviderReadinessEntry>>;
  refreshProviderCatalog: (providerKind: GraphProviderKind, options?: { announce?: boolean }) => Promise<void>;
};

const GraphProviderModelCatalogContext = createContext<GraphProviderModelCatalogContextValue>({
  catalogs: {},
  readiness: {},
  refreshProviderCatalog: async () => undefined,
});

function isGraphProviderKind(value: string): value is GraphProviderKind {
  return GRAPH_PROVIDER_KINDS.includes(value as GraphProviderKind);
}

export function GraphProviderModelCatalogProvider({
  value,
  children,
}: {
  value: GraphProviderModelCatalogContextValue;
  children: React.ReactNode;
}) {
  return <GraphProviderModelCatalogContext.Provider value={value}>{children}</GraphProviderModelCatalogContext.Provider>;
}

export function useGraphProviderModelCatalogContext() {
  return useContext(GraphProviderModelCatalogContext);
}

export function useGraphProviderModelCatalog({
  nodes,
  appendConsole,
}: {
  nodes: StudioNode[];
  appendConsole: (line: string) => void;
}) {
  const { catalogs, loadProviderCatalog } = useSharedProviderModelCatalog({
    ttlMs: GRAPH_PROVIDER_CATALOG_TTL_MS,
    appendConsole,
    probeRequest: probeSharedProviderCatalogRequest,
  });
  const readiness = useGraphProviderReadiness(nodes);

  useEffect(() => {
    const providersToEnsure = new Set<GraphProviderKind>();
    for (const node of nodes) {
      const definitionType = String(node.data.definition.type || "");
      if (definitionType !== "prompt.llm" && definitionType !== "prompt.recipe" && definitionType !== "prompt.image_analyzer") continue;
      const providerKind = String(node.data.fields.provider || "studio_default").trim();
      if (!isGraphProviderKind(providerKind)) continue;
      providersToEnsure.add(providerKind);
    }
    for (const providerKind of providersToEnsure) {
      const providerReadiness = readiness[providerKind];
      if (!providerReadiness) {
        continue;
      }
      if (!providerReadiness.ready) {
        continue;
      }
      const current = catalogs[providerKind];
      const stale = Boolean(current?.fetchedAt && Date.now() - current.fetchedAt > GRAPH_PROVIDER_CATALOG_TTL_MS);
      if (!current || current.status === "idle" || stale) {
        void loadProviderCatalog(providerKind, { force: stale, announce: false });
      }
    }
  }, [catalogs, loadProviderCatalog, nodes, readiness]);

  const refreshProviderCatalog = useCallback(
    async (providerKind: GraphProviderKind, options?: { announce?: boolean }) => {
      await loadProviderCatalog(providerKind, { force: true, announce: options?.announce ?? true });
    },
    [loadProviderCatalog],
  );

  return useMemo<GraphProviderModelCatalogContextValue>(
    () => ({
      catalogs,
      readiness,
      refreshProviderCatalog,
    }),
    [catalogs, readiness, refreshProviderCatalog],
  );
}

let sharedReadinessFetchedAt = 0;
let sharedReadinessValue: Partial<Record<GraphProviderKind, GraphProviderReadinessEntry>> = {};
let sharedReadinessInFlight: Promise<Partial<Record<GraphProviderKind, GraphProviderReadinessEntry>>> | null = null;

export function __resetGraphProviderReadinessCacheForTests() {
  sharedReadinessFetchedAt = 0;
  sharedReadinessValue = {};
  sharedReadinessInFlight = null;
}

function hasGraphPromptNodes(nodes: StudioNode[]) {
  return nodes.some((node) => {
    const definitionType = String(node.data.definition.type || "");
    return definitionType === "prompt.llm" || definitionType === "prompt.recipe" || definitionType === "prompt.image_analyzer";
  });
}

async function fetchGraphProviderReadiness() {
  const response = await fetch("/api/control/health", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Health check returned ${response.status}.`);
  }
  const health = (await response.json()) as ControlApiHealthData;
  const readiness = providerReadinessFromHealth(health);
  return {
    openrouter: {
      configured: readiness.openRouter.configured,
      ready: readiness.openRouter.ready,
    },
    codex_local: {
      configured: readiness.codexLocal.configured,
      ready: readiness.codexLocal.ready,
    },
    local_openai: {
      configured: readiness.localOpenAi.configured,
      ready: readiness.localOpenAi.ready,
    },
  } satisfies Partial<Record<GraphProviderKind, GraphProviderReadinessEntry>>;
}

function useGraphProviderReadiness(nodes: StudioNode[]) {
  const [readiness, setReadiness] = useState<Partial<Record<GraphProviderKind, GraphProviderReadinessEntry>>>(sharedReadinessValue);

  useEffect(() => {
    if (!hasGraphPromptNodes(nodes)) return;
    if (sharedReadinessFetchedAt > 0 && Date.now() - sharedReadinessFetchedAt < GRAPH_PROVIDER_READINESS_TTL_MS) {
      setReadinessState(setReadiness);
      return;
    }
    if (!sharedReadinessInFlight) {
      sharedReadinessInFlight = fetchGraphProviderReadiness()
        .then((next) => {
          sharedReadinessValue = next;
          sharedReadinessFetchedAt = Date.now();
          return next;
        })
        .finally(() => {
          sharedReadinessInFlight = null;
        });
    }
    void sharedReadinessInFlight
      .then((next) => {
        setReadinessState(setReadiness, next);
      })
      .catch(() => undefined);
  }, [nodes, setReadiness]);

  return readiness;
}

function setReadinessState(
  setReadiness: Dispatch<SetStateAction<Partial<Record<GraphProviderKind, GraphProviderReadinessEntry>>>>,
  next: Partial<Record<GraphProviderKind, GraphProviderReadinessEntry>> = sharedReadinessValue,
) {
  setReadiness((current) => {
    if (JSON.stringify(current) === JSON.stringify(next)) {
      return current;
    }
    return next;
  });
}
