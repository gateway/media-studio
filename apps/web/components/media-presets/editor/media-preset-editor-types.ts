import type { MediaPreset } from "@/lib/types";

export type PresetFieldInput = {
  id: string;
  key: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  required: boolean;
};

export type PresetImageSlotInput = {
  id: string;
  key: string;
  label: string;
  helpText: string;
  maxFiles: number;
  required: boolean;
};

export type PresetFormState = {
  presetId: string | null;
  sourceKind: MediaPreset["source_kind"];
  baseBuiltinKey: string | null;
  key: string;
  label: string;
  description: string;
  category: string;
  status: "active" | "inactive";
  appliesToModels: string[];
  promptTemplate: string;
  notes: string;
  inputFields: PresetFieldInput[];
  imageSlots: PresetImageSlotInput[];
  thumbnailPath: string;
  thumbnailUrl: string;
};
