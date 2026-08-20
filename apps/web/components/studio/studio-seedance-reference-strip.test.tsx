// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioSeedanceReferenceStrip } from "@/components/studio/studio-composer-input-strips";

describe("StudioSeedanceReferenceStrip", () => {
  afterEach(cleanup);

  it("renders the selected model's reference limits", () => {
    render(
      <StudioSeedanceReferenceStrip
        isDragActive={false}
        referenceImages={[]}
        referenceVideos={[]}
        referenceAudios={[]}
        maxImageReferences={30}
        maxVideoReferences={10}
        maxAudioReferences={10}
        buildAttachmentPreview={() => null}
        onSetDragActive={vi.fn()}
        onReferenceDrop={vi.fn()}
        onOpenPreview={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onAddFiles={vi.fn()}
        onResetFileInput={vi.fn()}
      />,
    );

    expect(screen.getByText("0 / 30")).toBeTruthy();
    expect(screen.getAllByText("0 / 10")).toHaveLength(2);
  });
});
