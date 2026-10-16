import { AdminSectionTabs } from "@/components/admin-section-tabs";
import { adminSectionStackClassName } from "@/components/admin-theme";
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
  presetsSeedValid?: boolean;
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
  presetsSeedValid,
  promptRecipes,
  enhancementConfigs,
  queueSettings,
  queuePolicies,
}: PresetsTabsProps) {
  return (
    <div className={adminSectionStackClassName}>
      <AdminSectionTabs items={tabItems} activeKey={activeTab} />

      {activeTab === "prompt-recipes" ? (
        <PromptRecipesList recipes={promptRecipes} />
      ) : (
        <MediaModelsConsole
          models={models}
          presets={presets}
          presetsTotal={presetsTotal}
          presetsNextOffset={presetsNextOffset}
          presetsSeedValid={presetsSeedValid}
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
