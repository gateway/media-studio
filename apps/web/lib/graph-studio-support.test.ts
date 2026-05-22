import { describe, expect, it } from "vitest";

import {
  GRAPH_STUDIO_MIN_DESKTOP_WIDTH,
  GRAPH_STUDIO_MIN_TOUCH_WIDTH,
  graphStudioSupportForViewport,
} from "@/components/graph-studio/utils/graph-studio-support";

describe("graph studio support", () => {
  it("blocks narrow desktop widths", () => {
    expect(
      graphStudioSupportForViewport({
        width: GRAPH_STUDIO_MIN_DESKTOP_WIDTH - 1,
        height: 900,
        coarsePointer: false,
      }),
    ).toMatchObject({ supported: false, reason: "small_window" });
  });

  it("blocks touch devices below the large-tablet threshold", () => {
    expect(
      graphStudioSupportForViewport({
        width: GRAPH_STUDIO_MIN_TOUCH_WIDTH - 1,
        height: 1180,
        coarsePointer: true,
      }),
    ).toMatchObject({ supported: false, reason: "small_touch" });
  });

  it("allows large-tablet and desktop layouts", () => {
    expect(
      graphStudioSupportForViewport({
        width: GRAPH_STUDIO_MIN_TOUCH_WIDTH,
        height: 1366,
        coarsePointer: true,
      }),
    ).toMatchObject({ supported: true });
    expect(
      graphStudioSupportForViewport({
        width: 1440,
        height: 900,
        coarsePointer: false,
      }),
    ).toMatchObject({ supported: true });
  });
});
