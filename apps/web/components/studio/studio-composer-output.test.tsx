// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";

import { StudioComposerControls, StudioComposerOutputPicker } from "@/components/studio/studio-composer-controls";
import { resolveStudioOptions } from "@/lib/studio-options";
import { studioStillFormat } from "@/lib/studio-output";
import type { MediaModelSummary } from "@/lib/types";

afterEach(cleanup);

const noop = () => {};
const svgAuthorLabels = { ui_choice_labels: { luna: "Luna", sol: "Sol" } };
const model: MediaModelSummary = {
  key: "any-model",
  label: "Any image model",
  provider_model: "any",
  task_modes: ["text_to_image"],
  studio_dynamic_options: [
    { key: "output_format", type: "enum", allowed: ["png", "jpeg", "webp", "gif", "svg"], default: "png" },
    { key: "output_compression", label: "Compression", type: "int_range", min: 0, max: 100,
      ui_visible_when: { output_format: ["jpeg", "webp"] } },
    { key: "frame_count", label: "Frame count", type: "int_range", min: 2, max: 16, default: 9,
      ui_visible_when: { output_format: "gif" } },
    { key: "frame_duration_ms", label: "Time per frame (ms)", type: "int_range", min: 20, max: 2000,
      default: 200, ui_step: 10, ui_visible_when: { output_format: "gif" } },
    { key: "size", label: "Frame size", type: "string", ui_control: "text", default: "auto",
      ui_visible_when: { output_format: "gif" } },
    { key: "svg_model", label: "SVG author", type: "enum", allowed: ["luna", "sol"], default: "luna",
      ui_visible_when: { output_format: "svg" }, ...svgAuthorLabels },
  ],
};

function Composer({ catalogModel }: { catalogModel: MediaModelSummary }) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [open, setOpen] = useState<string | null>(null);
  const { options, entries } = resolveStudioOptions(catalogModel, draft, null, "prompt_only");
  function update(key: string, value: unknown) {
    setDraft((current) => ({ ...current, studio_still_format: studioStillFormat(current), [key]: value }));
  }
  return (
    <>
      <StudioComposerOutputPicker
        entries={entries}
        value={options.output_format}
        stillFormat={draft.studio_still_format}
        onSelect={(format) => update("output_format", format)}
      />
      <StudioComposerControls
        structuredPresetActive={false}
        openPicker={open}
        modelKey={catalogModel.key}
        modelMaxOutputs={1}
        outputCount={1}
        compactOptionEntries={entries}
        optionValues={options}
        draftOptionValues={draft}
        canSubmit
        generateButtonLabel="Generate"
        onOpenPickerChange={setOpen}
        onOutputCountChange={noop}
        onOptionChange={update}
        onClear={noop}
        onSubmit={noop}
      />
      <span data-testid="request-options">{JSON.stringify(options)}</span>
    </>
  );
}

function selectChoice(key: string, value: string) {
  fireEvent.click(screen.getByTestId(`studio-picker-${key}`));
  fireEvent.click(screen.getByTestId(`studio-picker-option-${key}-${value}`));
}

function requestOptions() {
  return JSON.parse(screen.getByTestId("request-options").textContent ?? "{}");
}

it("switches formats, computes GIF loop length and restores prior options", () => {
  render(<Composer catalogModel={model} />);
  expect(screen.getByRole("button", { name: "Generate image" })).toBeTruthy();
  expect(screen.queryByLabelText("Compression")).toBeNull();
  selectChoice("output_format", "jpeg");
  fireEvent.change(screen.getByLabelText("Compression"), { target: { value: "65" } });
  expect(requestOptions()).toEqual({ output_format: "jpeg", output_compression: 65 });

  fireEvent.click(screen.getByRole("button", { name: "GIF" }));
  expect(screen.getByRole("button", { name: "Generate GIF" })).toBeTruthy();
  expect(screen.getByText("1.8 s per loop requested")).toBeTruthy();
  selectChoice("frame_count", "10");
  fireEvent.change(screen.getByLabelText("Time per frame (ms)"), { target: { value: "250" } });
  fireEvent.change(screen.getByLabelText("Frame size"), { target: { value: "384x512" } });
  expect(screen.getByText("2.5 s per loop requested")).toBeTruthy();
  expect(requestOptions()).toEqual({ output_format: "gif", frame_count: 10, frame_duration_ms: 250, size: "384x512" });

  fireEvent.click(screen.getByRole("button", { name: "SVG" }));
  expect(screen.getByRole("button", { name: "Generate SVG" })).toBeTruthy();
  expect(screen.queryByLabelText("Time per frame (ms)")).toBeNull();
  expect(screen.getByRole("button", { name: "SVG author · Luna" })).toBeTruthy();
  selectChoice("svg_model", "sol");
  expect(screen.getByRole("button", { name: "SVG author · Sol" })).toBeTruthy();
  expect(requestOptions()).toEqual({ output_format: "svg", svg_model: "sol" });

  fireEvent.click(screen.getByRole("button", { name: "Still image", exact: true }));
  expect(requestOptions()).toEqual({ output_format: "jpeg", output_compression: 65 });
  fireEvent.click(screen.getByRole("button", { name: "GIF" }));
  expect(screen.getByText("2.5 s per loop requested")).toBeTruthy();
});

it("keeps a single image group in the existing format picker", () => {
  const still: MediaModelSummary = { ...model, studio_dynamic_options: [
    { key: "output_format", type: "enum", allowed: ["png", "jpeg"], default: "png" },
  ] };
  render(<Composer catalogModel={still} />);
  expect(screen.queryByRole("group", { name: "Output" })).toBeNull();
  expect(screen.getByTestId("studio-picker-output_format")).toBeTruthy();
});
