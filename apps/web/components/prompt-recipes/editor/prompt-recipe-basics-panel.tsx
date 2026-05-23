"use client";

import { AdminField, AdminInput, AdminTextarea } from "@/components/admin-controls";
import { ThumbnailField } from "@/components/media/thumbnail-field";
import { Panel, PanelHeader } from "@/components/panel";
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

        <ThumbnailField
          imageUrl={draft.thumbnailUrl}
          emptyLabel="No thumbnail"
          inputRef={thumbnailInputRef}
          isUploading={isUploadingThumbnail}
          isBrowsing={thumbnailAssetsLoading}
          onChoose={onOpenGeneratedImages}
          onUploadFile={onThumbnailUpload}
          onRemove={() =>
            onDraftChange((current) => ({
              ...current,
              thumbnailPath: "",
              thumbnailUrl: "",
            }))
          }
        />
      </div>
    </Panel>
  );
}
