// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { StudioStructuredPresetComposer } from "./studio-structured-preset-composer";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import type { MediaPreset } from "@/lib/types";
import type { PresetSlotState } from "@/lib/media-studio-helpers";

const preset = {
  preset_id: "scene",
  label: "Character in a scene",
  description: "Place a character in an environment.",
} as MediaPreset;
const imageSlots = [
  {
    key: "character",
    label: "Character image",
    helpText: "Keep the character identity.",
    required: true,
    maxFiles: 1,
  },
  {
    key: "scene",
    label: "Scene image",
    helpText: "",
    required: false,
    maxFiles: 1,
  },
];
const textFields = [
  {
    key: "description",
    label: "Scene description",
    placeholder: "Describe the scene",
    defaultValue: "A castle at dusk",
    required: true,
  },
  {
    key: "mood",
    label: "Mood",
    placeholder: "Optional mood",
    defaultValue: "",
    required: false,
  },
];

function renderPreset(
  slotStates: Record<string, PresetSlotState> = {},
  fixed = false,
) {
  const callbacks = {
    onOpenPresets: vi.fn(),
    onPresetInputValuesChange: vi.fn(
      (updater: (current: Record<string, string>) => Record<string, string>) =>
        updater({ description: "Before", mood: "Quiet" }),
    ),
    onAssignSlotFile: vi.fn(),
    onClearSlot: vi.fn(),
    onOpenSlotLibrary: vi.fn(),
    onDropSlot: vi.fn(),
    onOpenPreview: vi.fn(),
    onResetFileInput: vi.fn(),
  };
  const view = render(
    <StudioStructuredPresetComposer
      preset={preset}
      imageSlots={imageSlots}
      textFields={fixed ? [] : textFields}
      slotStates={slotStates}
      inputValues={{ mood: "Quiet" }}
      localAssets={[]}
      favoriteAssets={[]}
      {...callbacks}
    />,
  );
  return { ...view, ...callbacks };
}

afterEach(cleanup);

it("keeps named schema defaults, explicit values and requiredness while updating only the selected field", () => {
  const { onPresetInputValuesChange, onOpenPresets } = renderPreset();
  const description = screen.getByRole("textbox", {
    name: "Scene description",
  });
  expect((description as HTMLInputElement).value).toBe("A castle at dusk");
  expect(description.getAttribute("aria-required")).toBe("true");
  expect(
    (screen.getByRole("textbox", { name: "Mood" }) as HTMLInputElement).value,
  ).toBe("Quiet");
  fireEvent.change(description, { target: { value: "Rain on the bridge" } });
  expect(onPresetInputValuesChange.mock.results[0].value).toEqual({
    description: "Rain on the bridge",
    mood: "Quiet",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Choose preset: Character in a scene" }),
  );
  expect(onOpenPresets).toHaveBeenCalledOnce();
});

it("opens a single-image file picker from Add and routes uploads and drops to their named slots", () => {
  const { onAssignSlotFile, onResetFileInput, onDropSlot } = renderPreset();
  const upload = screen.getByTestId<HTMLInputElement>(
    "studio-preset-slot-input-scene",
  );
  expect(upload.multiple).toBe(false);
  expect(upload.accept).toBe("image/*");
  const openFilePicker = vi.spyOn(upload, "click");
  fireEvent.click(screen.getByRole("button", { name: "Add Scene image" }));
  fireEvent.click(screen.getByText("Upload file"));
  expect(openFilePicker).toHaveBeenCalledOnce();
  expect(onAssignSlotFile).not.toHaveBeenCalled();
  const file = new File(["image"], "scene.png", { type: "image/png" });
  fireEvent.change(upload, { target: { files: [file] } });
  expect(onAssignSlotFile).toHaveBeenCalledOnce();
  expect(onAssignSlotFile).toHaveBeenCalledWith("scene", file);
  expect(onResetFileInput).toHaveBeenCalledWith(upload);
  fireEvent.drop(
    screen.getByRole("button", { name: "Add Character image (required)" }),
    { dataTransfer: { files: [file] } },
  );
  expect(onDropSlot.mock.calls[0][1]).toBe("character");
});

it("preserves preview identity, replacement and individual removal for filled named slots", () => {
  const { onOpenPreview, onClearSlot, onAssignSlotFile, onResetFileInput } =
    renderPreset({
      character: { assetId: null, file: null, previewUrl: "/character.png" },
      scene: { assetId: null, file: null, previewUrl: "/scene.png" },
    });
  fireEvent.click(
    screen.getByRole("button", { name: "Character image", exact: true }),
  );
  expect(onOpenPreview).toHaveBeenCalledWith(
    expect.objectContaining({
      key: "preset-slot:character",
      label: "Character image",
      url: "/character.png",
    }),
  );
  const replacement = screen.getByTestId("studio-preset-slot-input-scene");
  const openFilePicker = vi.spyOn(replacement, "click");
  fireEvent.click(screen.getByRole("button", { name: "Replace Scene image" }));
  fireEvent.click(screen.getByText("Upload file"));
  expect(openFilePicker).toHaveBeenCalledOnce();
  const file = new File(["replacement"], "new.png", { type: "image/png" });
  fireEvent.change(replacement, { target: { files: [file] } });
  expect(onAssignSlotFile).toHaveBeenCalledWith("scene", file);
  expect(onResetFileInput).toHaveBeenCalledWith(replacement);
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Character image" }),
  );
  expect(onClearSlot).toHaveBeenCalledWith("character");
  expect(onClearSlot).toHaveBeenCalledOnce();
});

it("opens the library for the clicked named slot without clearing an existing image", () => {
  const { onOpenSlotLibrary, onClearSlot } = renderPreset({
    scene: { assetId: null, file: null, previewUrl: "/scene.png" },
  });
  const filled = screen.getByRole("button", {
    name: "Replace Scene image",
  });
  const empty = screen.getByRole("button", {
    name: "Add Character image (required)",
  });
  fireEvent.click(filled);
  fireEvent.click(
    within(screen.getByTestId("studio-preset-slot-filled-scene")).getByText(
      "Choose from library",
    ),
  );
  fireEvent.click(empty);
  fireEvent.click(
    within(screen.getByTestId("studio-preset-slot-character")).getByText(
      "Choose from library",
    ),
  );
  expect(onOpenSlotLibrary.mock.calls).toEqual([
    [imageSlots[1], filled],
    [imageSlots[0], empty],
  ]);
  expect(onClearSlot).not.toHaveBeenCalled();
  expect(screen.getByTestId("studio-preset-slot-filled-scene")).toBeTruthy();
  expect(screen.queryByText("Choose from library")).toBeNull();
});

it("keeps fixed prompts free of editable text while retaining their named image inputs", () => {
  renderPreset({}, true);
  expect(
    screen.getByText(
      "This preset uses a fixed prompt. No text input is needed.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Add Character image (required)" }),
  ).toBeTruthy();
});

it("keeps default admin consumers unthemed and preserves navigation when a preset editor opts into Studio appearance", () => {
  const props = {
    section: "presets" as const,
    title: "Preset",
    description: "Existing form",
    currentProjectId: "project-1",
    children: <input aria-label="Existing field" defaultValue="Keep me" />,
  };
  const view = render(<StudioAdminShell {...props} />);
  expect(view.container.firstElementChild?.className).toBe(
    "admin-theme-root admin-page-background",
  );
  const before = screen
    .getByRole("link", { name: "Studio", exact: true })
    .getAttribute("href");
  view.rerender(
    <StudioAdminShell {...props} className="studio-preset-editor-theme" />,
  );
  expect(view.container.firstElementChild?.className).toContain(
    "studio-preset-editor-theme",
  );
  expect(
    screen
      .getByRole("link", { name: "Studio", exact: true })
      .getAttribute("href"),
  ).toBe(before);
  expect(
    (
      screen.getByRole("textbox", {
        name: "Existing field",
      }) as HTMLInputElement
    ).value,
  ).toBe("Keep me");
});
