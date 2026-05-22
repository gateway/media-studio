import { useCallback, useMemo, useState } from "react";

import type { GraphNodeDefinition } from "../types";
import { graphDefinitionAcceptsInput, graphDefinitionEmitsOutput } from "../utils/graph-port-compatibility";

export type GraphNodeSearchConnection = {
  from: "input" | "output";
  portType: string;
  nodeId: string | null;
  handleId: string | null;
};

export type GraphNodeSearchPopoverState = {
  x: number;
  y: number;
  flowPosition?: { x: number; y: number } | null;
  query: string;
  connection?: GraphNodeSearchConnection | null;
};

export type RankedGraphNodeDefinition = {
  definition: GraphNodeDefinition;
  score: number;
};

type ParsedQuery = {
  terms: string[];
  inputTypes: string[];
  outputTypes: string[];
  categories: string[];
  sources: string[];
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], inputTypes: [], outputTypes: [], categories: [], sources: [] };
  query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .forEach((token) => {
      const lower = token.toLowerCase();
      const [prefix, ...rest] = lower.split(":");
      const value = rest.join(":");
      if (prefix === "i" && value) parsed.inputTypes.push(value);
      else if (prefix === "o" && value) parsed.outputTypes.push(value);
      else if (prefix === "c" && value) parsed.categories.push(value);
      else if (prefix === "s" && value) parsed.sources.push(value);
      else parsed.terms.push(lower);
    });
  return parsed;
}

function definitionSource(definition: GraphNodeDefinition) {
  const sourceKind = definition.source?.kind;
  return typeof sourceKind === "string" ? sourceKind : "system";
}

export function graphDefinitionHiddenInSearch(definition: GraphNodeDefinition) {
  return Boolean(definition.source && typeof definition.source === "object" && definition.source.hidden_in_search);
}

function scoreDefinition(definition: GraphNodeDefinition, terms: string[]) {
  if (!terms.length) return 100;
  const title = normalize(definition.title);
  const type = normalize(definition.type);
  const category = normalize(definition.category);
  const aliases = (definition.search_aliases ?? []).map(normalize);
  const description = normalize(definition.description);
  let score = 0;
  terms.forEach((term) => {
    if (title === term || type === term) score += 120;
    else if (title.startsWith(term)) score += 90;
    else if (aliases.some((alias) => alias === term || alias.startsWith(term))) score += 75;
    else if (category.includes(term)) score += 50;
    else if (title.includes(term) || type.includes(term)) score += 42;
    else if (description.includes(term)) score += 18;
    else score -= 15;
  });
  return score;
}

export function rankGraphNodeDefinitions(
  definitions: GraphNodeDefinition[],
  query: string,
  connection?: GraphNodeSearchConnection | null,
): RankedGraphNodeDefinition[] {
  const parsed = parseQuery(query);
  return definitions
    .filter((definition) => {
      if (graphDefinitionHiddenInSearch(definition)) return false;
      if (connection?.from === "output" && !graphDefinitionAcceptsInput(definition, connection.portType)) return false;
      if (connection?.from === "input" && !graphDefinitionEmitsOutput(definition, connection.portType)) return false;
      if (parsed.inputTypes.length && !parsed.inputTypes.every((portType) => graphDefinitionAcceptsInput(definition, portType))) return false;
      if (parsed.outputTypes.length && !parsed.outputTypes.every((portType) => graphDefinitionEmitsOutput(definition, portType))) return false;
      if (parsed.categories.length && !parsed.categories.some((category) => normalize(definition.category).includes(category))) return false;
      if (parsed.sources.length && !parsed.sources.some((source) => normalize(definitionSource(definition)).includes(source))) return false;
      return true;
    })
    .map((definition) => ({ definition, score: scoreDefinition(definition, parsed.terms) }))
    .filter((item) => item.score > 0 || parsed.terms.length === 0)
    .sort((a, b) => b.score - a.score || a.definition.title.localeCompare(b.definition.title));
}

export function useGraphNodeSearchResults(
  definitions: GraphNodeDefinition[],
  query: string,
  connection?: GraphNodeSearchConnection | null,
) {
  return useMemo(() => rankGraphNodeDefinitions(definitions, query, connection), [connection, definitions, query]);
}

export function useGraphNodeSearchState(screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number }) {
  const [nodeSearch, setNodeSearch] = useState<GraphNodeSearchPopoverState | null>(null);
  const openNodeSearch = useCallback(
    (x: number, y: number, connection?: GraphNodeSearchPopoverState["connection"]) => {
      setNodeSearch({
        x: Math.max(68, Math.min(x, window.innerWidth - 390)),
        y: Math.max(68, Math.min(y, window.innerHeight - 440)),
        flowPosition: screenToFlowPosition({ x, y }),
        query: "",
        connection: connection ?? null,
      });
    },
    [screenToFlowPosition],
  );
  return { nodeSearch, setNodeSearch, openNodeSearch };
}
