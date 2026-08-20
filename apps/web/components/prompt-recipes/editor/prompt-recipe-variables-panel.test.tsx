// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PromptRecipeVariablesPanel } from "@/components/prompt-recipes/editor/prompt-recipe-variables-panel";
import { promptRecipeToDraft } from "@/lib/prompt-recipes";

describe("PromptRecipeVariablesPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows reference role controls only for image-backed fields", () => {
    const draft = promptRecipeToDraft({
      key: "role_editor_test",
      label: "Role Editor Test",
      system_prompt_template: "{{user_prompt}} {{setting}}",
      custom_fields_json: [
        {
          key: "setting",
          label: "Setting",
          type: "textarea",
          input_kind: "image",
          reference_role: "environment",
        },
      ],
    });

    render(
      <PromptRecipeVariablesPanel
        draft={draft}
        onUpdateVariable={vi.fn()}
        onUpdateCustomField={vi.fn()}
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Reference Role")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Environment" })).toBeTruthy();
  });

  it("hides reference role controls for text-backed fields", () => {
    const draft = promptRecipeToDraft({
      key: "text_field_editor_test",
      label: "Text Field Editor Test",
      system_prompt_template: "{{user_prompt}} {{setting}}",
      custom_fields_json: [
        {
          key: "setting",
          label: "Setting",
          type: "textarea",
          input_kind: "text",
          reference_role: "environment",
        },
      ],
    });

    render(
      <PromptRecipeVariablesPanel
        draft={draft}
        onUpdateVariable={vi.fn()}
        onUpdateCustomField={vi.fn()}
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("Reference Role")).toBeNull();
  });

  it("keeps reserved graph inputs collapsed while custom fields stay prominent", () => {
    const draft = promptRecipeToDraft({
      key: "reserved_input_editor_test",
      label: "Reserved Input Editor Test",
      system_prompt_template: "{{user_prompt}} {{setting}}",
      custom_fields_json: [
        {
          key: "setting",
          label: "Setting",
          type: "textarea",
        },
      ],
    });

    render(
      <PromptRecipeVariablesPanel
        draft={draft}
        onUpdateVariable={vi.fn()}
        onUpdateCustomField={vi.fn()}
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Recipe fields")).toBeTruthy();
    expect(screen.getByDisplayValue("setting")).toBeTruthy();

    const advancedDisclosure = screen.getByText("Advanced graph inputs").closest("details");
    expect(advancedDisclosure?.hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByText("Advanced graph inputs"));
    expect(advancedDisclosure?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Source Prompt")).toBeTruthy();
  });

  it("keeps recipe-specific variables prominent instead of hiding them as advanced graph inputs", () => {
    const draft = promptRecipeToDraft({
      key: "storyboard_editor_test",
      label: "Storyboard Editor Test",
      system_prompt_template: "{{user_prompt}} {{dialogue_mode}}",
      input_variables_json: [
        { key: "user_prompt", label: "User Prompt", enabled: true, required: true },
        { key: "dialogue_mode", label: "Dialogue Mode", enabled: true, default_value: "none", description: "Dialogue density." },
      ],
    });

    render(
      <PromptRecipeVariablesPanel
        draft={draft}
        onUpdateVariable={vi.fn()}
        onUpdateCustomField={vi.fn()}
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByText("1 recipe fields")).toBeTruthy();
    expect(screen.getByDisplayValue("dialogue_mode")).toBeTruthy();
    expect(screen.getByDisplayValue("Dialogue Mode")).toBeTruthy();

    const advancedDisclosure = screen.getByText("Advanced graph inputs").closest("details");
    expect(advancedDisclosure?.hasAttribute("open")).toBe(false);
    expect(advancedDisclosure?.textContent).toContain("reserved inputs");
  });
});
