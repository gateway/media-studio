"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import type { MediaModelSummary, MediaSystemPrompt } from "@/lib/types";
import { cn } from "@/lib/utils";

type MediaPromptsConsoleProps = {
  models: MediaModelSummary[];
  prompts: MediaSystemPrompt[];
};

type PromptFormState = {
  promptId: string | null;
  key: string;
  label: string;
  description: string;
  status: string;
  content: string;
  roleTag: string;
  appliesToModels: string[];
  appliesToTaskModes: string;
  appliesToInputPatterns: string;
  notes: string;
};

function emptyPromptForm(): PromptFormState {
  return {
    promptId: null,
    key: "",
    label: "",
    description: "",
    status: "active",
    content: "",
    roleTag: "general",
    appliesToModels: [],
    appliesToTaskModes: "",
    appliesToInputPatterns: "",
    notes: "",
  };
}

function fromCsv(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toCsv(values: string[] | undefined) {
  return (values ?? []).join(", ");
}

export function MediaPromptsConsole({ models, prompts }: MediaPromptsConsoleProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(prompts[0]?.prompt_id ?? null);
  const [formState, setFormState] = useState<PromptFormState>(
    prompts[0]
      ? {
          promptId: prompts[0].prompt_id,
          key: prompts[0].key,
          label: prompts[0].label,
          description: prompts[0].description ?? "",
          status: prompts[0].status,
          content: prompts[0].content,
          roleTag: prompts[0].role_tag,
          appliesToModels: prompts[0].applies_to_models,
          appliesToTaskModes: toCsv(prompts[0].applies_to_task_modes),
          appliesToInputPatterns: toCsv(prompts[0].applies_to_input_patterns),
          notes: prompts[0].notes ?? "",
        }
      : emptyPromptForm(),
  );
  const [message, setMessage] = useState<{ tone: "healthy" | "danger"; text: string } | null>(null);

  const selectedPrompt = prompts.find((prompt) => prompt.prompt_id === selectedPromptId) ?? null;

  function loadPrompt(prompt: MediaSystemPrompt) {
    setSelectedPromptId(prompt.prompt_id);
    setFormState({
      promptId: prompt.prompt_id,
      key: prompt.key,
      label: prompt.label,
      description: prompt.description ?? "",
      status: prompt.status,
      content: prompt.content,
      roleTag: prompt.role_tag,
      appliesToModels: prompt.applies_to_models,
      appliesToTaskModes: toCsv(prompt.applies_to_task_modes),
      appliesToInputPatterns: toCsv(prompt.applies_to_input_patterns),
      notes: prompt.notes ?? "",
    });
  }

  function resetPromptForm() {
    setSelectedPromptId(null);
    setFormState(emptyPromptForm());
    setMessage(null);
  }

  function toggleModel(modelKey: string) {
    setFormState((current) => ({
      ...current,
      appliesToModels: current.appliesToModels.includes(modelKey)
        ? current.appliesToModels.filter((value) => value !== modelKey)
        : [...current.appliesToModels, modelKey],
    }));
  }

  async function savePrompt() {
    const payload = {
      key: formState.key,
      label: formState.label,
      description: formState.description || null,
      status: formState.status,
      content: formState.content,
      role_tag: formState.roleTag,
      applies_to_models: formState.appliesToModels,
      applies_to_task_modes: fromCsv(formState.appliesToTaskModes),
      applies_to_input_patterns: fromCsv(formState.appliesToInputPatterns),
      notes: formState.notes || null,
    };

    const endpoint = formState.promptId
      ? `/api/control/media-prompts/${formState.promptId}`
      : "/api/control/media-prompts";
    const method = formState.promptId ? "PATCH" : "POST";
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };

    if (!response.ok || result.ok === false) {
      setMessage({ tone: "danger", text: result.error ?? "Unable to save the system prompt." });
      return;
    }

    setMessage({ tone: "healthy", text: formState.promptId ? "System prompt updated." : "System prompt created." });
    startRefresh(() => router.refresh());
    resetPromptForm();
  }

  async function archivePrompt(promptId: string) {
    const response = await fetch(`/api/control/media-prompts/${promptId}`, { method: "DELETE" });
    const result = (await response.json()) as { ok?: boolean; error?: string };

    if (!response.ok || result.ok === false) {
      setMessage({ tone: "danger", text: result.error ?? "Unable to archive the system prompt." });
      return;
    }

    setMessage({ tone: "healthy", text: "System prompt archived." });
    startRefresh(() => router.refresh());
    resetPromptForm();
  }

  return (
    <div className="grid gap-7 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Panel>
        <PanelHeader
          eyebrow="Prompt library"
          title="Global system prompts"
          description="System prompts stay reusable and model-aware. They can be referenced directly from the composer with `@` or linked into model-scoped presets."
        />
        <div className="mt-5 grid gap-3">
          {prompts.length ? (
            prompts.map((prompt) => (
              <button
                key={prompt.prompt_id}
                type="button"
                onClick={() => loadPrompt(prompt)}
                className={cn(
                  "rounded-[22px] border px-4 py-4 text-left transition",
                  prompt.prompt_id === selectedPromptId
                    ? "border-[rgba(208,255,72,0.24)] bg-[rgba(208,255,72,0.1)] shadow-[0_16px_30px_rgba(0,0,0,0.18)]"
                    : "border-white/8 bg-[rgba(12,15,14,0.94)]",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold tracking-[-0.03em] text-[var(--foreground)]">{prompt.label}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                      @{prompt.key}
                    </div>
                  </div>
                  <StatusPill label={prompt.role_tag} tone="neutral" />
                </div>
                <p className="mt-3 text-sm leading-7 text-[var(--muted-strong)]">
                  {prompt.description ?? "No description published yet."}
                </p>
              </button>
            ))
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-[rgba(12,15,14,0.94)] px-4 py-4 text-sm leading-7 text-[var(--muted-strong)]">
              No system prompts exist yet.
            </div>
          )}
        </div>
      </Panel>

      <div className="grid gap-7">
        <Panel>
          <PanelHeader
            eyebrow="Editor"
            title={formState.promptId ? "Edit system prompt" : "Create system prompt"}
            description="Create reusable operator-facing prompts such as first-frame, last-frame, image-edit, or motion-control helpers. Archive instead of hard deleting so lineage stays intact."
          />
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid gap-3">
              <input
                value={formState.key}
                onChange={(event) => setFormState((current) => ({ ...current, key: event.target.value }))}
                placeholder="Prompt key"
                className="rounded-[16px] border border-[var(--surface-border)] bg-white px-3 py-3 text-sm"
              />
              <input
                value={formState.label}
                onChange={(event) => setFormState((current) => ({ ...current, label: event.target.value }))}
                placeholder="Prompt label"
                className="rounded-[16px] border border-[var(--surface-border)] bg-white px-3 py-3 text-sm"
              />
              <input
                value={formState.description}
                onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
                placeholder="Short description"
                className="rounded-[16px] border border-[var(--surface-border)] bg-white px-3 py-3 text-sm"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={formState.status}
                  onChange={(event) => setFormState((current) => ({ ...current, status: event.target.value }))}
                  className="rounded-[16px] border border-[var(--surface-border)] bg-white px-3 py-3 text-sm"
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                  <option value="archived">archived</option>
                </select>
                <select
                  value={formState.roleTag}
                  onChange={(event) => setFormState((current) => ({ ...current, roleTag: event.target.value }))}
                  className="rounded-[16px] border border-[var(--surface-border)] bg-white px-3 py-3 text-sm"
                >
                  <option value="general">general</option>
                  <option value="first_frame">first_frame</option>
                  <option value="last_frame">last_frame</option>
                  <option value="image_edit">image_edit</option>
                  <option value="motion_control">motion_control</option>
                </select>
              </div>
              <textarea
                value={formState.content}
                onChange={(event) => setFormState((current) => ({ ...current, content: event.target.value }))}
                placeholder="Prompt content"
                className="min-h-[220px] rounded-[16px] border border-[var(--surface-border)] bg-white px-3 py-3 text-sm leading-7"
              />
              <input
                value={formState.appliesToTaskModes}
                onChange={(event) => setFormState((current) => ({ ...current, appliesToTaskModes: event.target.value }))}
                placeholder="Task modes CSV"
                className="rounded-[16px] border border-[var(--surface-border)] bg-white px-3 py-3 text-sm"
              />
              <input
                value={formState.appliesToInputPatterns}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, appliesToInputPatterns: event.target.value }))
                }
                placeholder="Input patterns CSV"
                className="rounded-[16px] border border-[var(--surface-border)] bg-white px-3 py-3 text-sm"
              />
              <textarea
                value={formState.notes}
                onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Operator notes"
                className="min-h-[90px] rounded-[16px] border border-[var(--surface-border)] bg-white px-3 py-3 text-sm"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void savePrompt()}
                  className="rounded-full bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-5 py-3 text-sm font-semibold text-[#162400]"
                >
                  {formState.promptId ? "Save prompt" : "Create prompt"}
                </button>
                <button
                  type="button"
                  onClick={resetPromptForm}
                  className="rounded-full border border-[var(--surface-border)] bg-white px-4 py-3 text-sm font-semibold text-[var(--foreground)]"
                >
                  Reset
                </button>
                {formState.promptId ? (
                  <button
                    type="button"
                    onClick={() => void archivePrompt(formState.promptId as string)}
                    className="rounded-full border border-[rgba(175,79,64,0.18)] bg-white px-4 py-3 text-sm font-semibold text-[var(--danger)]"
                  >
                    Archive
                  </button>
                ) : null}
              </div>
              {message ? (
                <div
                  className={cn(
                    "rounded-[18px] border px-3 py-3 text-sm",
                    message.tone === "healthy"
                      ? "border-[rgba(81,136,111,0.18)] bg-[rgba(81,136,111,0.08)] text-[var(--success)]"
                      : "border-[rgba(175,79,64,0.18)] bg-[rgba(175,79,64,0.08)] text-[var(--danger)]",
                  )}
                >
                  {message.text}
                </div>
              ) : null}
              {isRefreshing ? (
                <div className="text-xs uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                  Refreshing prompt studio...
                </div>
              ) : null}
            </div>

            <div className="grid gap-4">
              <div className="rounded-[22px] border border-white/10 bg-[rgba(12,15,14,0.94)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
                  Render preview
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--foreground)]">
                  {formState.content || "Your system prompt content will preview here as you type."}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-[rgba(12,15,14,0.94)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                  Model applicability
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {models.map((model) => {
                    const active = formState.appliesToModels.includes(model.key);
                    return (
                      <button
                        key={model.key}
                        type="button"
                        onClick={() => toggleModel(model.key)}
                        className={cn(
                          "rounded-full border px-3 py-2 text-xs uppercase tracking-[0.12em] transition",
                          active
                            ? "border-[rgba(208,255,72,0.24)] bg-[rgba(208,255,72,0.12)] text-[var(--accent-strong)]"
                            : "border-white/10 bg-[rgba(255,255,255,0.04)] text-[var(--muted-strong)]",
                        )}
                      >
                        {model.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {selectedPrompt ? (
                <div className="rounded-[22px] border border-white/10 bg-[rgba(12,15,14,0.94)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                    Current selection
                  </div>
                  <div className="mt-3 text-sm font-medium text-[var(--foreground)]">{selectedPrompt.label}</div>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">
                    {selectedPrompt.description ?? "No description yet."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill label={selectedPrompt.status} tone={selectedPrompt.status === "active" ? "healthy" : "warning"} />
                    <StatusPill label={selectedPrompt.role_tag} tone="neutral" />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
