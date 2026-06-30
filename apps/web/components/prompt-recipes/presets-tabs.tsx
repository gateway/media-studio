import { AdminButton } from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import { adminCompactTabButtonClassName, adminSectionStackClassName, adminTabsRowClassName } from "@/components/admin-theme";
import { MediaModelsConsole } from "@/components/media-models-console";
import { PromptRecipesList } from "@/components/prompt-recipes/prompt-recipes-list";
import type {
  MediaEnhancementConfig,
  MediaModelQueuePolicy,
  MediaModelSummary,
  MediaPreset,
  MediaQueueSettings,
  PromptRecipe,
} from "@/lib/types";

type PresetsTabsProps = {
  activeTab: "media" | "prompt-recipes";
  models: MediaModelSummary[];
  presets: MediaPreset[];
  presetsTotal?: number;
  presetsNextOffset?: number | null;
  promptRecipes: PromptRecipe[];
  enhancementConfigs: MediaEnhancementConfig[];
  queueSettings: MediaQueueSettings | null;
  queuePolicies: MediaModelQueuePolicy[];
};

const tabItems = [
  { key: "media", label: "Media Presets", href: "/presets?tab=media" },
  { key: "prompt-recipes", label: "Prompt Recipes", href: "/presets?tab=prompt-recipes" },
] as const;

export function PresetsTabs({
  activeTab,
  models,
  presets,
  presetsTotal,
  presetsNextOffset,
  promptRecipes,
  enhancementConfigs,
  queueSettings,
  queuePolicies,
}: PresetsTabsProps) {
  return (
    <div className={adminSectionStackClassName}>
      <div className={adminTabsRowClassName}>
        {tabItems.map((item) =>
          activeTab === item.key ? (
            <AdminButton
              key={item.key}
              variant="primary"
              size="compact"
              className={adminCompactTabButtonClassName}
              aria-current="page"
              disabled
            >
              {item.label}
            </AdminButton>
          ) : (
            <AdminNavButton
              key={item.key}
              href={item.href}
              variant="subtle"
              size="compact"
              className={adminCompactTabButtonClassName}
            >
              {item.label}
            </AdminNavButton>
          ),
        )}
      </div>

      {activeTab === "prompt-recipes" ? (
        <PromptRecipesList recipes={promptRecipes} />
      ) : (
        <MediaModelsConsole
          models={models}
          presets={presets}
          presetsTotal={presetsTotal}
          presetsNextOffset={presetsNextOffset}
          enhancementConfigs={enhancementConfigs}
          queueSettings={queueSettings}
          queuePolicies={queuePolicies}
          sections={{
            queue: false,
            enhancementProvider: false,
            modelHelper: false,
            studioSettings: false,
            modelPanel: false,
            presets: true,
          }}
        />
      )}
    </div>
  );
}
