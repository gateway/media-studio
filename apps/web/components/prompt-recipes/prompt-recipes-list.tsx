"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { Copy, Download, Edit3, Plus, Search, Trash2, Upload } from "lucide-react";

import { AdminButton, adminButtonIconLabelClassName, adminInputWithIconClassName } from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import {
  adminFilterToolbarClassName,
  adminHeaderActionRowClassName,
  adminListActionGroupClassName,
  adminListRowClassName,
  adminListThumbnailClassName,
  adminListThumbnailFallbackClassName,
} from "@/components/admin-theme";
import { Panel, PanelHeader } from "@/components/panel";
import { CalloutPanel, EmptyState, SurfaceInset } from "@/components/ui/surface-primitives";
import {
  promptRecipeMediaFrameClassName,
  promptRecipeSearchIconClassName,
  promptRecipeSearchInputClassName,
  promptRecipeSecondaryMetaClassName,
} from "@/components/prompt-recipes/prompt-recipe-admin-theme";
import {
  detectPromptRecipeVariables,
  PROMPT_RECIPE_CATEGORIES,
  PROMPT_RECIPE_OUTPUT_FORMATS,
  slugifyPromptRecipeKey,
} from "@/lib/prompt-recipes";
import { invalidateGraphNodeDefinitions } from "@/lib/graph-node-definitions-sync";
import type { PromptRecipe } from "@/lib/types";
import { cn } from "@/lib/utils";

type PromptRecipesListProps = {
  recipes: PromptRecipe[];
};

function recipeImageInputLabel(recipe: PromptRecipe) {
  const input = recipe.image_input_json ?? recipe.image_input;
  if (!input?.enabled) {
    return "No image input";
  }
  return input.required ? "Image required" : "Image optional";
}

export function PromptRecipesList({ recipes }: PromptRecipesListProps) {
  const [localRecipes, setLocalRecipes] = useState(recipes);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [busyRecipeId, setBusyRecipeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const filteredRecipes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return localRecipes.filter((recipe) => {
      if (category !== "all" && recipe.category !== category) {
        return false;
      }
      if (status !== "all" && recipe.status !== status) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [recipe.label, recipe.key, recipe.description, recipe.notes]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [category, localRecipes, search, status]);

  async function duplicateRecipe(recipe: PromptRecipe) {
    setBusyRecipeId(recipe.recipe_id);
    setMessage(null);
    const key = `${slugifyPromptRecipeKey(recipe.key)}_copy_${Date.now().toString().slice(-5)}`;
    const response = await fetch("/api/control/prompt-recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...recipe,
        recipe_id: undefined,
        key,
        label: `${recipe.label} Copy`,
        status: "inactive",
        source_kind: "custom",
      }),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string; recipe?: PromptRecipe };
    setBusyRecipeId(null);
    if (!response.ok || result.ok === false || !result.recipe) {
      setMessage(result.error ?? "Unable to duplicate the prompt recipe.");
      return;
    }
    await invalidateGraphNodeDefinitions("prompt-recipe-created");
    setLocalRecipes((current) => [result.recipe!, ...current]);
    setMessage("Prompt recipe duplicated as inactive.");
  }

  async function archiveRecipe(recipe: PromptRecipe) {
    setBusyRecipeId(recipe.recipe_id);
    setMessage(null);
    const response = await fetch(`/api/control/prompt-recipes/${recipe.recipe_id}`, { method: "DELETE" });
    const result = (await response.json()) as { ok?: boolean; error?: string; recipe?: PromptRecipe };
    setBusyRecipeId(null);
    if (!response.ok || result.ok === false) {
      setMessage(result.error ?? "Unable to archive the prompt recipe.");
      return;
    }
    await invalidateGraphNodeDefinitions("prompt-recipe-archived");
    setLocalRecipes((current) =>
      current.map((entry) => (entry.recipe_id === recipe.recipe_id ? { ...entry, status: "archived" } : entry)),
    );
    setMessage("Prompt recipe archived.");
  }

  async function exportRecipe(recipe: PromptRecipe) {
    setBusyRecipeId(recipe.recipe_id);
    setMessage(null);
    try {
      const response = await fetch(`/api/control/prompt-recipes/export/${recipe.recipe_id}`);
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        setMessage(result?.error ?? "Unable to export the prompt recipe.");
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement("a");
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileNameMatch = disposition.match(/filename=\"?([^"]+)\"?/i);
      downloadLink.href = objectUrl;
      downloadLink.download = fileNameMatch?.[1] ?? `${recipe.key || "prompt_recipe"}.zip`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setMessage("Prompt recipe exported.");
    } catch {
      setMessage("Unable to export the prompt recipe.");
    } finally {
      setBusyRecipeId(null);
    }
  }

  async function importRecipe(file: File) {
    setIsImporting(true);
    setMessage(null);
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch("/api/control/prompt-recipes/import", {
      method: "POST",
      body: formData,
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      message?: string;
      recipe?: PromptRecipe | null;
    };
    setIsImporting(false);
    if (!response.ok || result.ok === false) {
      setMessage(result.error ?? "Unable to import the prompt recipe.");
      return;
    }
    await invalidateGraphNodeDefinitions("prompt-recipe-imported");
    if (result.recipe) {
      setLocalRecipes((current) => [result.recipe!, ...current.filter((entry) => entry.recipe_id !== result.recipe!.recipe_id)]);
    }
    setMessage(result.message ?? "Prompt recipe imported.");
  }

  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        eyebrow="Prompt Recipes"
        title="LLM director templates"
        description="Saved, validated prompt-generation recipes for future Graph node ingestion. These do not execute LLM calls in this admin slice."
        action={
          <div className={adminHeaderActionRowClassName}>
            <input
              ref={importInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void importRecipe(file);
                }
                event.currentTarget.value = "";
              }}
            />
            <AdminButton variant="subtle" onClick={() => importInputRef.current?.click()} disabled={isImporting}>
              <span className={adminButtonIconLabelClassName}>
                <Upload className="size-4" />
                {isImporting ? "Importing..." : "Import"}
              </span>
            </AdminButton>
            <AdminNavButton href="/presets/prompt-recipes/new">
              <span className={adminButtonIconLabelClassName}>
                <Plus className="size-4" />
                New Prompt Recipe
              </span>
            </AdminNavButton>
          </div>
        }
      />

      <SurfaceInset appearance="admin" density="compact" className={adminFilterToolbarClassName}>
        <label className="grid gap-2">
          <span className="admin-field-label">Search</span>
          <div className={adminInputWithIconClassName}>
            <Search className={promptRecipeSearchIconClassName} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search recipes"
              className={promptRecipeSearchInputClassName}
            />
          </div>
        </label>
        <label className="grid gap-2">
          <span className="admin-field-label">Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="admin-input text-sm">
            <option value="all">All Categories</option>
            {PROMPT_RECIPE_CATEGORIES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2">
          <span className="admin-field-label">Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="admin-input text-sm">
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </SurfaceInset>

      {message ? (
        <CalloutPanel appearance="admin" tone={message.toLowerCase().includes("unable") ? "danger" : "default"} className="mt-4 text-sm">
          {message}
        </CalloutPanel>
      ) : null}

      <div className="mt-5 grid gap-3">
        {filteredRecipes.length ? filteredRecipes.map((recipe) => {
          const detectedVariables = detectPromptRecipeVariables(recipe.system_prompt_template ?? "");
          const outputFormat = PROMPT_RECIPE_OUTPUT_FORMATS.find((entry) => entry.value === recipe.output_format)?.label ?? recipe.output_format;
          const validationWarnings = recipe.validation_warnings_json ?? recipe.validation_warnings ?? [];
          return (
            <article key={recipe.recipe_id} className={adminListRowClassName}>
              <div className={cn(adminListThumbnailClassName, promptRecipeMediaFrameClassName)}>
                {recipe.thumbnail_url ? (
                  <Image src={recipe.thumbnail_url} alt="" fill sizes="80px" className="object-cover" />
                ) : (
                  <div className={adminListThumbnailFallbackClassName}>
                    {String(recipe.category).slice(0, 3)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-[var(--foreground)]">{recipe.label}</h3>
                  <span className="admin-status-pill">{recipe.status}</span>
                  <span className="admin-status-pill">{recipe.category}</span>
                  <span className="admin-status-pill">{outputFormat}</span>
                </div>
                <p className="text-sm text-[var(--muted-strong)]">{recipe.description || "No description yet."}</p>
                <div className={promptRecipeSecondaryMetaClassName}>
                  <span>{recipe.key}</span>
                  <span>{recipeImageInputLabel(recipe)}</span>
                  <span>{(recipe.custom_fields_json ?? recipe.custom_fields ?? []).length} custom fields</span>
                  <span>{detectedVariables.length ? `Variables: ${detectedVariables.join(", ")}` : "No variables detected"}</span>
                  {validationWarnings.length ? <span>{validationWarnings.length} warnings</span> : null}
                </div>
              </div>
              <div className={adminListActionGroupClassName}>
                <AdminNavButton
                  href={`/presets/prompt-recipes/${recipe.recipe_id}`}
                  variant="subtle"
                  size="compact"
                  className="!px-[0.9rem]"
                  title={`Edit ${recipe.label}`}
                >
                  <Edit3 className="size-3.5" />
                  <span className="sr-only">Edit</span>
                </AdminNavButton>
                <AdminButton
                  variant="subtle"
                  size="compact"
                  title={`Duplicate ${recipe.label}`}
                  onClick={() => duplicateRecipe(recipe)}
                  disabled={busyRecipeId === recipe.recipe_id}
                >
                  <Copy className="size-3.5" />
                  <span className="sr-only">Duplicate</span>
                </AdminButton>
                <AdminButton
                  variant="subtle"
                  size="compact"
                  title={`Export ${recipe.label}`}
                  onClick={() => exportRecipe(recipe)}
                  disabled={busyRecipeId === recipe.recipe_id}
                >
                  <Download className="size-3.5" />
                  <span className="sr-only">Export</span>
                </AdminButton>
                <AdminButton
                  variant="danger"
                  size="compact"
                  title={`Archive ${recipe.label}`}
                  onClick={() => archiveRecipe(recipe)}
                  disabled={busyRecipeId === recipe.recipe_id || recipe.status === "archived"}
                  className={cn(recipe.status === "archived" ? "opacity-50" : "")}
                >
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">Archive</span>
                </AdminButton>
              </div>
            </article>
          );
        }) : (
          <EmptyState
            appearance="admin"
            eyebrow="Prompt Recipes"
            title="No recipes match the current filters."
            description="Adjust the search, category, or status filters to find a saved recipe."
          />
        )}
      </div>
    </Panel>
  );
}
