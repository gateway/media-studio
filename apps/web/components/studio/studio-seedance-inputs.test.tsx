// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { useSeedanceComposerInputs } from "@/components/studio/studio-seedance-inputs";
import { StudioComposer } from "@/components/studio/studio-composer";
import { StudioComposerControls } from "@/components/studio/studio-composer-controls";
import { StudioSourceAttachmentStrip } from "@/components/studio/studio-composer-input-strips";
import { buildAttachmentPreview } from "@/lib/studio-reference-previews";
import type { AttachmentRecord } from "@/lib/media-studio-contract";

afterEach(cleanup);

function CollapsibleSeedanceInputs({ mode }: { mode: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const inputs = useSeedanceComposerInputs({
    seedance: true,
    effectiveMode: mode,
    referenceInputs: <div>Reference inputs</div>,
    sourceAttachmentStrip: <div>Frame inputs</div>,
    mobileInputsContent: null,
  });
  return (
    <StudioComposer
      immersive
      composerCollapsed={collapsed}
      mobileComposerCollapsed={false}
      mobileComposerExpanded
      currentModelLabel="Seedance 2.5"
      formattedRemainingCredits={null}
      estimatedCredits={null}
      structuredPresetActive={false}
      presetLabel={null}
      floatingComposerStatus={null}
      onToggleCollapsed={() => undefined}
      onToggleComposerCollapsed={() => setCollapsed((value) => !value)}
      {...inputs}
    >
      <div>Prompt and options remain in their existing owner</div>
    </StudioComposer>
  );
}

it.each([
  ["prompt_only", "References"],
  ["multimodal_reference", "Frames"],
])(
  "retains the selected %s input view across composer collapse",
  (mode, selected) => {
    render(<CollapsibleSeedanceInputs mode={mode} />);
    fireEvent.click(screen.getByRole("tab", { name: selected }));
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Studio composer" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Studio composer" }),
    );
    expect(
      screen.getByRole("tab", { name: selected, selected: true }),
    ).toBeTruthy();
  },
);

function StagedInput() {
  const [value, setValue] = useState("staged");
  return (
    <input
      aria-label="Staged reference"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

function SeedanceInputs({ effectiveMode }: { effectiveMode: string }) {
  return useSeedanceComposerInputs({
    seedance: true,
    effectiveMode,
    sourceAttachmentStrip: <div>Frame inputs</div>,
    referenceInputs: <StagedInput />,
    mobileInputsContent: null,
  }).referenceInputs;
}

it("switches input views with the keyboard and preserves staged state, following changed input roles", () => {
  const { rerender } = render(<SeedanceInputs effectiveMode="prompt_only" />);
  expect(screen.getByRole("tabpanel").textContent).toBe("Frame inputs");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Frames" }), {
    key: "ArrowRight",
  });
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: "References", selected: true }),
  );
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "kept" } });
  fireEvent.click(screen.getByRole("tab", { name: "Frames" }));
  fireEvent.click(screen.getByRole("tab", { name: "References" }));
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("kept");
  rerender(<SeedanceInputs effectiveMode="single_image" />);
  expect(
    screen.getByRole("tab", { name: "Frames", selected: true }),
  ).toBeTruthy();
  rerender(<SeedanceInputs effectiveMode="multimodal_reference" />);
  expect(
    screen.getByRole("tab", { name: "References", selected: true }),
  ).toBeTruthy();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("kept");
});

function frameProps() {
  return {
    inputRail: "seedance",
    isDragActive: false,
    seedanceFirstFrameAttachment: null,
    seedanceLastFrameAttachment: null,
    standardComposerSlots: [],
    orderedImageInputs: [],
    mobileAddTileClassName: "",
    mobileAddTilePlusIconClassName: "",
    buildAttachmentPreview,
    standardComposerSlotPreview: () => null,
    standardComposerSlotVisual: () => null,
    onSetDragActive: vi.fn(),
    onSetFormWarning: vi.fn(),
    onDropIntoSourceSlot: vi.fn(),
    onOpenPreview: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onClearStandardComposerSlot: vi.fn(),
    onPickStandardComposerSlotFiles: vi.fn(),
    onAddFiles: vi.fn(),
    onResetFileInput: vi.fn(),
  } satisfies ComponentProps<typeof StudioSourceAttachmentStrip>;
}

it("keeps frame upload/drop roles and guards end input until a start frame exists", () => {
  const props = frameProps();
  const { rerender } = render(<StudioSourceAttachmentStrip {...props} />);
  const start = screen.getByLabelText("Add start frame");
  const end = screen.getByLabelText("Add end frame");
  const files = [new File([], "frame.png", { type: "image/png" })];
  fireEvent.change(end, { target: { files } });
  expect(props.onAddFiles).not.toHaveBeenCalled();
  expect(props.onSetFormWarning).toHaveBeenCalledWith(
    "Add a start frame before the end frame.",
  );
  expect(props.onResetFileInput).toHaveBeenCalledWith(end);
  fireEvent.change(start, { target: { files } });
  expect(props.onAddFiles).toHaveBeenLastCalledWith(files, {
    role: "first_frame",
    allowedKinds: ["images"],
  });
  const first: AttachmentRecord = {
    id: "first",
    kind: "images",
    role: "first_frame",
    file: null,
    previewUrl: "/first.png",
  };
  rerender(
    <StudioSourceAttachmentStrip
      {...props}
      seedanceFirstFrameAttachment={first}
    />,
  );
  fireEvent.change(screen.getByLabelText("Add end frame"), {
    target: { files },
  });
  expect(props.onAddFiles).toHaveBeenLastCalledWith(files, {
    role: "last_frame",
    allowedKinds: ["images"],
  });
  fireEvent.drop(screen.getByLabelText("Add end frame").closest("label")!);
  expect(props.onDropIntoSourceSlot).toHaveBeenLastCalledWith(
    expect.anything(),
    1,
  );
  const filled = screen.getByTestId("seedance-slot-filled-first_frame");
  fireEvent.change(within(filled).getByLabelText("Replace start frame"), {
    target: { files },
  });
  expect(props.onRemoveAttachment).toHaveBeenLastCalledWith("first");
  expect(props.onAddFiles).toHaveBeenLastCalledWith(files, {
    role: "first_frame",
    allowedKinds: ["images"],
  });
  expect(props.onOpenPreview).not.toHaveBeenCalled();
});

it.each([
  "seedance-2.0",
  "seedance-2.0-fast",
  "seedance-2.0-mini",
  "seedance-2.5",
])(
  "uses runtime boolean values and existing option callbacks for %s",
  (modelKey) => {
    const onOptionChange = vi.fn();
    const props = {
      modelKey,
      structuredPresetActive: false,
      openPicker: null,
      outputCount: 1,
      modelMaxOutputs: 1,
      compactOptionEntries: [
        ["return_last_frame", { type: "bool", default: true }],
        ["web_search", { type: "bool", default: false }],
      ],
      optionValues: { return_last_frame: false },
      inferredInputPattern: "first_last_frames",
      canSubmit: false,
      generateButtonLabel: "Generate",
      onOpenPickerChange: vi.fn(),
      onOutputCountChange: vi.fn(),
      onOptionChange,
      onClear: vi.fn(),
      onSubmit: vi.fn(),
    } satisfies ComponentProps<typeof StudioComposerControls>;
    const { rerender } = render(<StudioComposerControls {...props} />);
    const frame = screen.getByRole("switch", {
      name: "Return last frame",
      checked: false,
    });
    fireEvent.click(frame);
    expect(onOptionChange).toHaveBeenLastCalledWith("return_last_frame", true);
    fireEvent.click(
      screen.getByRole("switch", { name: "Web search", checked: false }),
    );
    expect(onOptionChange).toHaveBeenLastCalledWith("web_search", true);
    expect(screen.queryByRole("switch", { name: "NSFW checker" })).toBeNull();
    expect(
      (screen.getByTestId("studio-generate-button") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    rerender(<StudioComposerControls {...props} optionValues={{}} />);
    expect(
      screen.getByRole("switch", { name: "Return last frame", checked: true }),
    ).toBeTruthy();
  },
);

it("labels automatic duration without changing its selected or serialized value", () => {
  const onOptionChange = vi.fn();
  render(
    <StudioComposerControls
      modelKey="seedance-2.5"
      structuredPresetActive={false}
      openPicker="duration"
      outputCount={1}
      modelMaxOutputs={1}
      compactOptionEntries={[
        ["duration", { type: "int_range", allowed: [-1], min: 4, max: 30 }],
      ]}
      optionValues={{ duration: -1 }}
      inferredInputPattern="prompt_only"
      canSubmit={false}
      generateButtonLabel="Generate"
      onOpenPickerChange={vi.fn()}
      onOutputCountChange={vi.fn()}
      onOptionChange={onOptionChange}
      onClear={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
  expect(screen.getByTestId("studio-picker-duration").textContent).toBe("Auto");
  fireEvent.click(screen.getByTestId("studio-picker-option-duration--1"));
  expect(onOptionChange).toHaveBeenCalledExactlyOnceWith("duration", -1);
});
