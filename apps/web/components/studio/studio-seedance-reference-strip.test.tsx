// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioSeedanceReferenceStrip } from "@/components/studio/studio-composer-input-strips";

describe("StudioSeedanceReferenceStrip", () => {
  afterEach(cleanup);

  it("renders the selected model's reference limits", () => {
    render(
      <StudioSeedanceReferenceStrip
        modelLabel="Seedance 2.5"
        expanded={false}
        suspended={false}
        onExpandedChange={vi.fn()}
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
        onOpenLibrary={vi.fn()}
        onAddFiles={vi.fn()}
        onResetFileInput={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("tab", { name: "Images 0/30", selected: true }),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Videos 0/10" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Audio 0/10" })).toBeTruthy();
  });
});
