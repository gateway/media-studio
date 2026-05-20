"use client";

import Image from "next/image";
import { Images, Upload } from "lucide-react";

import { AdminButton, AdminField, AdminInput, AdminTextarea, adminButtonIconLabelClassName } from "@/components/admin-controls";
import { Panel, PanelHeader } from "@/components/panel";
import {
  promptRecipeMediaFallbackClassName,
  promptRecipeMediaOverlayClassName,
  promptRecipeThumbnailButtonClassName,
} from "@/components/prompt-recipes/prompt-recipe-admin-theme";
import { PROMPT_RECIPE_CATEGORIES, slugifyPromptRecipeKey, type PromptRecipeEditorDraft } from "@/lib/prompt-recipes";

export function PromptRecipeBasicsPanel({
  draft,
  generatedKey,
  onDraftChange,
  thumbnailInputRef,
  isUploadingThumbnail,
  thumbnailAssetsLoading,
  onOpenGeneratedImages,
  onThumbnailUpload,
  headerAction,
}: {
  draft: PromptRecipeEditorDraft;
  generatedKey: string;
  onDraftChange: (updater: (current: PromptRecipeEditorDraft) => PromptRecipeEditorDraft) => void;
  thumbnailInputRef: React.RefObject<HTMLInputElement | null>;
  isUploadingThumbnail: boolean;
  thumbnailAssetsLoading: boolean;
  onOpenGeneratedImages: () => void;
  onThumbnailUpload: (file: File) => void;
  headerAction?: React.ReactNode;
}) {
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        eyebrow="Prompt Recipe"
        title={draft.recipeId ? draft.label || "Edit prompt recipe" : "Create prompt recipe"}
        description="Define a saved LLM director template for later Graph node ingestion. This editor stores the recipe only; it does not run the LLM."
        action={headerAction}
      />

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="admin-surface-accent p-4 sm:p-5">
          <div className="admin-label-accent mb-4">Recipe Basics</div>
          <div className="grid gap-3">
            <AdminField label="Recipe Name">
              <AdminInput
                value={draft.label}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    label: event.target.value,
                    key: current.recipeId ? current.key : "",
                  }))
                }
              />
            </AdminField>
            <AdminField label="Key" description="Stable lowercase key used by APIs and future graph nodes.">
              <AdminInput
                value={generatedKey}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    key: slugifyPromptRecipeKey(event.target.value),
                  }))
                }
              />
            </AdminField>
            <AdminField label="Description">
              <AdminTextarea
                rows={3}
                value={draft.description ?? ""}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </AdminField>
            <div className="grid gap-3 sm:grid-cols-3">
              <AdminField label="Category">
                <select
                  value={draft.category}
                  onChange={(event) =>
                    onDraftChange((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                  className="admin-input text-sm"
                >
                  {PROMPT_RECIPE_CATEGORIES.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </AdminField>
              <AdminField label="Status">
                <select
                  value={draft.status}
                  onChange={(event) =>
                    onDraftChange((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
                  className="admin-input text-sm"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="archived">Archived</option>
                </select>
              </AdminField>
              <AdminField label="Priority">
                <AdminInput
                  type="number"
                  value={draft.priority}
                  onChange={(event) =>
                    onDraftChange((current) => ({
                      ...current,
                      priority: Number(event.target.value),
                    }))
                  }
                />
              </AdminField>
            </div>
          </div>
        </div>

        <div className="admin-surface-accent p-4 sm:p-5">
          <div className="admin-label-accent mb-4">Thumbnail</div>
          <div className="grid gap-4">
            <button
              type="button"
              onClick={onOpenGeneratedImages}
              className={promptRecipeThumbnailButtonClassName}
              aria-label="Choose from generated images"
            >
              {draft.thumbnailUrl ? (
                <Image src={draft.thumbnailUrl} alt="" fill sizes="420px" className="object-cover" />
              ) : (
                <div className={promptRecipeMediaFallbackClassName}>No thumbnail</div>
              )}
              <div className={promptRecipeMediaOverlayClassName}>
                <span>Choose from generated images</span>
                <Images className="size-4" />
              </div>
            </button>
            <input
              ref={thumbnailInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onThumbnailUpload(file);
                }
                event.currentTarget.value = "";
              }}
            />
            <div className="flex flex-wrap gap-2">
              <AdminButton variant="subtle" onClick={() => thumbnailInputRef.current?.click()} disabled={isUploadingThumbnail}>
                <span className={adminButtonIconLabelClassName}>
                  <Upload className="size-4" />
                  {isUploadingThumbnail ? "Uploading..." : "Upload"}
                </span>
              </AdminButton>
              <AdminButton variant="subtle" onClick={onOpenGeneratedImages} disabled={thumbnailAssetsLoading}>
                <span className={adminButtonIconLabelClassName}>
                  <Images className="size-4" />
                  {thumbnailAssetsLoading ? "Loading..." : "Generated Images"}
                </span>
              </AdminButton>
              <AdminButton
                variant="subtle"
                onClick={() =>
                  onDraftChange((current) => ({
                    ...current,
                    thumbnailPath: "",
                    thumbnailUrl: "",
                  }))
                }
              >
                Remove
              </AdminButton>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
