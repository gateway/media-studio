import { useEffect, useState } from "react";

import { isCoarsePointerDevice } from "@/lib/media-studio-helpers";

import { graphStudioSupportForViewport, type GraphStudioSupportState } from "../utils/graph-studio-support";

function currentGraphStudioSupportState(): GraphStudioSupportState {
  if (typeof window === "undefined") {
    return graphStudioSupportForViewport({ width: 1440, height: 900, coarsePointer: false });
  }
  return graphStudioSupportForViewport({
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: isCoarsePointerDevice(),
  });
}

export function useGraphStudioSupport() {
  const [state, setState] = useState<GraphStudioSupportState>(() => currentGraphStudioSupportState());

  useEffect(() => {
    const update = () => setState(currentGraphStudioSupportState());
    update();
    const coarsePointerMedia = window.matchMedia?.("(pointer: coarse)");
    window.addEventListener("resize", update);
    coarsePointerMedia?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener("resize", update);
      coarsePointerMedia?.removeEventListener?.("change", update);
    };
  }, []);

  return state;
}
