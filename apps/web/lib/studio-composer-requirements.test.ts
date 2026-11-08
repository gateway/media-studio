import { expect, it } from "vitest";
import {
  studioPresetRequirementError,
  studioRequiredInputError,
} from "./studio-composer-requirements";
import type { MediaModelSummary } from "./types";

const presetOptions: Parameters<typeof studioPresetRequirementError>[0] = {
  presetDetailPending: false,
  structuredPresetActive: true,
  currentPresetCompatibleWithModel: true,
  currentPreset: { label: "Portrait" } as Parameters<
    typeof studioPresetRequirementError
  >[0]["currentPreset"],
  structuredPresetTextFields: [
    {
      key: "subject",
      label: "Subject",
      defaultValue: "Default",
      placeholder: "",
      required: true,
    },
  ],
  structuredPresetImageSlots: [
    { key: "face", label: "Face", helpText: "", required: true, maxFiles: 1 },
  ],
  presetInputValues: {},
  presetSlotStates: {},
  attachments: [],
  sourceAsset: null,
};

it("keeps loading, required text and named-slot errors in the existing order", () => {
  expect(
    studioPresetRequirementError({
      ...presetOptions,
      presetDetailPending: true,
    }),
  ).toBe("Preset details are still loading.");
  expect(
    studioPresetRequirementError({
      ...presetOptions,
      presetInputValues: { subject: "  " },
    }),
  ).toBe("The preset Portrait requires the text field Subject.");
  expect(studioPresetRequirementError(presetOptions)).toBe(
    "The preset Portrait requires the image slot Face.",
  );
  expect(
    studioPresetRequirementError({
      ...presetOptions,
      presetSlotStates: {
        face: { assetId: "existing", file: null, previewUrl: null },
      },
    }),
  ).toBeNull();
});

it("keeps legacy preset requirements conditional on compatibility", () => {
  const options = {
    ...presetOptions,
    structuredPresetActive: false,
    currentPreset: { ...presetOptions.currentPreset!, requires_video: true },
  };
  expect(studioPresetRequirementError(options)).toBe(
    "The preset Portrait requires at least one video.",
  );
  expect(
    studioPresetRequirementError({
      ...options,
      currentPresetCompatibleWithModel: false,
    }),
  ).toBeNull();
});

const inputOptions: Parameters<typeof studioRequiredInputError>[0] = {
  slots: [],
  model: null,
  attachments: [],
  sourceAsset: null,
  optionValues: {},
  stagedImageCount: 0,
  structuredPresetImageInputCount: 0,
};

it.each([undefined, null, 0, -1, "invalid"])(
  "does not invent a required image count for %s",
  (required_min) => {
    const model = {
      image_inputs: { required_min },
    } as unknown as MediaModelSummary;
    expect(studioRequiredInputError({ ...inputOptions, model })).toBeNull();
  },
);

it("counts staged and structured images together without changing the required minimum", () => {
  const model = {
    image_inputs: { required_min: "2" },
  } as unknown as MediaModelSummary;
  expect(
    studioRequiredInputError({ ...inputOptions, model, stagedImageCount: 1 }),
  ).toBe(
    "Add 2 source images before generating with this image-to-image model.",
  );
  expect(
    studioRequiredInputError({
      ...inputOptions,
      model,
      stagedImageCount: 1,
      structuredPresetImageInputCount: 1,
    }),
  ).toBeNull();
  expect(
    studioRequiredInputError({
      ...inputOptions,
      model: { image_inputs: { required_min: 1 } } as MediaModelSummary,
    }),
  ).toBe(
    "Add a source image before generating with this image-to-image model.",
  );
});

it("retains named-role precedence over generic image requirements", () => {
  const slot = {
    visible: true,
    required: true,
    filled: false,
    label: "Driving Video",
  } as Parameters<typeof studioRequiredInputError>[0]["slots"][number];
  expect(studioRequiredInputError({ ...inputOptions, slots: [slot] })).toBe(
    "Add driving video before generating with this model.",
  );
});
