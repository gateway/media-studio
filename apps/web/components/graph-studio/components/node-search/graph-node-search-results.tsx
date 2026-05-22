import { Blocks } from "lucide-react";

import type { RankedGraphNodeDefinition } from "../../hooks/use-graph-node-search";
import type { GraphNodeDefinition } from "../../types";
import { graphNodeIconToken } from "../../utils/graph-node-layout";

type GraphNodeSearchResultsProps = {
  results: RankedGraphNodeDefinition[];
  activeIndex: number;
  onSelect: (definition: GraphNodeDefinition) => void;
};

export function GraphNodeSearchResults({ results, activeIndex, onSelect }: GraphNodeSearchResultsProps) {
  if (!results.length) {
    return <div className="graph-node-search-empty">No matching nodes.</div>;
  }
  return (
    <div className="graph-node-search-results" role="listbox" aria-label="Node search results">
      {results.map(({ definition }, index) => (
        <button
          aria-selected={index === activeIndex}
          className={index === activeIndex ? "graph-node-search-result graph-node-search-result-active" : "graph-node-search-result"}
          data-testid={`graph-node-search-result-${definition.type}`}
          key={definition.type}
          role="option"
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(definition)}
        >
          <span className={`graph-node-search-icon graph-node-search-icon-${graphNodeIconToken(definition)}`}>
            <Blocks size={14} />
          </span>
          <span>
            <strong>{definition.title}</strong>
            <small>{definition.category}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
