// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioComposer } from "@/components/studio/studio-composer";
import { StudioSeedanceReferenceStrip } from "@/components/studio/studio-composer-input-strips";
import type { AttachmentRecord } from "@/lib/media-studio-contract";
import { buildAttachmentPreview } from "@/lib/studio-reference-previews";

afterEach(cleanup);

function props() {
  return {
    suspended: false,
    maxImageReferences: 30,
    maxVideoReferences: 10,
    maxAudioReferences: 10,
    isDragActive: false,
    referenceImages: [],
    referenceVideos: [],
    referenceAudios: [],
    buildAttachmentPreview,
    onSetDragActive: vi.fn(),
    onReferenceDrop: vi.fn(),
    onOpenPreview: vi.fn(),
    onOpenLibrary: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onAddFiles: vi.fn(),
    onResetFileInput: vi.fn(),
  } satisfies Omit<
    ComponentProps<typeof StudioSeedanceReferenceStrip>,
    "expanded" | "onExpandedChange"
  >;
}

function MobileReferenceHarness(props: ReturnType<typeof props>) {
  const [expanded, setExpanded] = useState(false);
  return (
    <StudioComposer
      immersive
      composerCollapsed={false}
      mobileComposerCollapsed={false}
      mobileComposerExpanded
      currentModelLabel="Seedance"
      formattedRemainingCredits={null}
      estimatedCredits={null}
      structuredPresetActive={false}
      presetLabel={null}
      floatingComposerStatus={null}
      onToggleCollapsed={vi.fn()}
      onToggleComposerCollapsed={vi.fn()}
      referenceInputs={
        <StudioSeedanceReferenceStrip
          {...props}
          expanded={expanded}
          onExpandedChange={setExpanded}
        />
      }
    >
      <textarea aria-label="Prompt" />
    </StudioComposer>
  );
}

const groups = [
  {
    kind: "images",
    field: "referenceImages",
    tab: "Images",
    limit: 30,
    oldLimit: 9,
    visible: 4,
    mime: "image/png",
  },
  {
    kind: "videos",
    field: "referenceVideos",
    tab: "Videos",
    limit: 10,
    oldLimit: 3,
    visible: 4,
    mime: "video/mp4",
  },
  {
    kind: "audios",
    field: "referenceAudios",
    tab: "Audio",
    limit: 10,
    oldLimit: 3,
    visible: 4,
    mime: "audio/wav",
  },
] as const;

function references(
  kind: AttachmentRecord["kind"],
  count: number,
): AttachmentRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind}-${index}`,
    kind,
    role: "reference",
    file: null,
    previewUrl: `/reference-${index}`,
  }));
}

describe.each(groups)(
  "phone Seedance $kind limits",
  ({ kind, field, limit, oldLimit, visible, mime, tab }) => {
    function selectTab() {
      fireEvent.click(
        screen.getByRole("tab", { name: new RegExp(`^${tab} `) }),
      );
    }

    it.each([0, oldLimit, limit - 1, limit, limit + 1])(
      "uses model capacity at %i references",
      (count) => {
        render(
          <MobileReferenceHarness
            {...props()}
            {...{ [field]: references(kind, count) }}
          />,
        );
        selectTab();
        expect(
          screen.getByRole("tab", {
            name: `${tab} ${count}/${limit}`,
            selected: true,
          }),
        ).toBeTruthy();
        expect(
          Boolean(screen.queryByTestId(`seedance-group-input-${kind}`)),
        ).toBe(count < limit);
        if (count > visible) {
          const shown = count < limit ? visible - 1 : visible;
          expect(screen.getByText(`+${count - shown}`)).toBeTruthy();
        }
      },
    );

    it("updates controls when switching 2.0 → 2.5 → 2.0 without losing references", () => {
      const base = props();
      const attachments = references(kind, oldLimit);
      const low = {
        maxImageReferences: 9,
        maxVideoReferences: 3,
        maxAudioReferences: 3,
      };
      const { rerender } = render(
        <MobileReferenceHarness
          {...base}
          {...low}
          {...{ [field]: attachments }}
        />,
      );
      selectTab();
      const inputId = `seedance-group-input-${kind}`;
      expect(screen.queryByTestId(inputId)).toBeNull();
      rerender(
        <MobileReferenceHarness {...base} {...{ [field]: attachments }} />,
      );
      expect(screen.getByTestId(inputId)).toBeTruthy();
      expect(
        screen.getByRole("tab", { name: `${tab} ${oldLimit}/${limit}` }),
      ).toBeTruthy();
      rerender(
        <MobileReferenceHarness
          {...base}
          {...low}
          {...{ [field]: attachments }}
        />,
      );
      expect(screen.queryByTestId(inputId)).toBeNull();
      expect(
        screen.getByRole("tab", { name: `${tab} ${oldLimit}/${oldLimit}` }),
      ).toBeTruthy();
      expect(base.onRemoveAttachment).not.toHaveBeenCalled();
    });

    it("restores adding after removal below capacity without opening a preview", () => {
      const base = props();
      const attachments = references(kind, limit);
      const { rerender } = render(
        <MobileReferenceHarness {...base} {...{ [field]: attachments }} />,
      );
      selectTab();
      expect(screen.queryByTestId(`seedance-group-input-${kind}`)).toBeNull();
      fireEvent.click(
        screen.getByTestId(`seedance-group-tile-${kind}-${kind}-0-remove`),
      );
      expect(base.onRemoveAttachment).toHaveBeenCalledWith(`${kind}-0`);
      expect(base.onOpenPreview).not.toHaveBeenCalled();
      rerender(
        <MobileReferenceHarness
          {...base}
          {...{ [field]: attachments.slice(1) }}
        />,
      );
      expect(screen.getByTestId(`seedance-group-input-${kind}`)).toBeTruthy();
    });

    it("keeps upload kind, reference role and input reset", () => {
      const base = props();
      render(<MobileReferenceHarness {...base} />);
      selectTab();
      const input = screen.getByTestId(`seedance-group-input-${kind}`);
      const files = [new File([], "reference", { type: mime })];
      fireEvent.change(input, { target: { files } });
      expect(base.onAddFiles).toHaveBeenCalledExactlyOnceWith(files, {
        role: "reference",
        allowedKinds: [kind],
      });
      expect(base.onResetFileInput).toHaveBeenCalledExactlyOnceWith(input);
    });
  },
);

it("hides all reference add controls for a zero-capacity model", () => {
  render(
    <MobileReferenceHarness
      {...props()}
      maxImageReferences={0}
      maxVideoReferences={0}
      maxAudioReferences={0}
    />,
  );
  expect(screen.queryByRole("tablist")).toBeNull();
  for (const { kind } of groups)
    expect(screen.queryByTestId(`seedance-group-input-${kind}`)).toBeNull();
});

it("uses one manager for hidden slots and preserves the selected kind and drop routing", () => {
  const base = props();
  const videos = references("videos", 7);
  render(<MobileReferenceHarness {...base} referenceVideos={videos} />);

  const compactImages = screen.getByRole("tab", { name: "Images 0/30" });
  fireEvent.keyDown(compactImages, { key: "ArrowRight" });
  const compactVideos = screen.getByRole("tab", {
    name: "Videos 7/10",
    selected: true,
  });
  expect(document.activeElement).toBe(compactVideos);
  fireEvent.drop(compactVideos);
  expect(base.onReferenceDrop).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    "videos",
  );

  const overflow = screen.getByRole("button", {
    name: "Show 4 more video references",
  });
  fireEvent.click(overflow);
  const dialog = screen.getByRole("dialog", { name: "References" });
  const manager = within(dialog);
  const managerVideos = manager.getByRole("tab", {
    name: "Videos 7/10",
    selected: true,
  });
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(managerVideos);
  expect(
    manager.queryByRole("button", { name: "Choose from library" }),
  ).toBeNull();

  expect(manager.queryByLabelText("Replace video reference 7")).toBeNull();
  fireEvent.click(
    manager.getByTestId("seedance-group-tile-videos-videos-6-remove"),
  );
  expect(base.onRemoveAttachment).toHaveBeenCalledExactlyOnceWith(videos[6].id);

  fireEvent.click(manager.getByRole("tab", { name: "Images 0/30" }));
  fireEvent.click(manager.getByRole("button", { name: "Choose from library" }));
  expect(base.onOpenLibrary).toHaveBeenCalledTimes(1);

  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole("tab", { name: "Images 0/30", selected: true }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Expand image references" }),
  );
});
