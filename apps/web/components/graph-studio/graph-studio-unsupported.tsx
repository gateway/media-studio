import type { GraphStudioSupportState } from "./utils/graph-studio-support";

export function GraphStudioUnsupported({ state }: { state: GraphStudioSupportState }) {
  const detail =
    state.reason === "small_touch"
      ? "Use desktop or a large tablet in landscape. Phone-sized touch screens are not supported."
      : "Open Graph Studio in a wider desktop window to edit workflows safely.";

  return (
    <div className="graph-unsupported-shell" aria-label="Graph Studio unsupported screen">
      <div className="graph-unsupported-panel">
        <div className="graph-unsupported-eyebrow">Graph Studio</div>
        <h1>Not supported on this screen</h1>
        <p>{detail}</p>
        <div className="graph-unsupported-metrics">
          <span>
            Viewport <strong>{state.width} x {state.height}</strong>
          </span>
          <span>
            Pointer <strong>{state.coarsePointer ? "touch" : "fine"}</strong>
          </span>
        </div>
        <div className="graph-unsupported-actions">
          <a href="/studio">Back to Studio</a>
        </div>
      </div>
    </div>
  );
}
