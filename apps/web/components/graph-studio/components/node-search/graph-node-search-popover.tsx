import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useGraphNodeSearchResults, type GraphNodeSearchPopoverState } from "../../hooks/use-graph-node-search";
import type { GraphNodeDefinition } from "../../types";
import { GraphNodeSearchResults } from "./graph-node-search-results";

type GraphNodeSearchPopoverProps = {
  state: GraphNodeSearchPopoverState;
  definitions: GraphNodeDefinition[];
  onQueryChange: (query: string) => void;
  onSelect: (definition: GraphNodeDefinition) => void;
  onClose: () => void;
};

export function GraphNodeSearchPopover({ state, definitions, onQueryChange, onSelect, onClose }: GraphNodeSearchPopoverProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useGraphNodeSearchResults(definitions, state.query, state.connection);
  const label = state.connection ? `Compatible ${state.connection.portType} nodes` : "Search nodes";
  const style = useMemo(
    () => ({
      left: state.x,
      top: state.y,
    }),
    [state.x, state.y],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [state.query, state.connection]);

  const boundedActiveIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  return (
    <div className="graph-node-search-popover" data-testid="graph-node-search-popover" role="dialog" aria-label={label} style={style}>
      <div className="graph-node-search-heading">
        <span>{label}</span>
        <kbd>Esc</kbd>
      </div>
      <label className="graph-search">
        <Search size={15} />
        <input
          autoFocus
          value={state.query}
          placeholder="Search nodes, i:image, o:text, c:media, s:system"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(results.length - 1, current + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const selected = results[boundedActiveIndex]?.definition;
              if (selected) onSelect(selected);
            }
          }}
        />
      </label>
      <GraphNodeSearchResults results={results} activeIndex={boundedActiveIndex} onSelect={onSelect} />
    </div>
  );
}
