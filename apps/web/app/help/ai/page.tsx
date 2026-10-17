import Link from "next/link";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { Panel, PanelHeader } from "@/components/panel";

export default function AiHelpPage() {
  return <StudioAdminShell section="settings" title="AI connections and models" description="Connect providers, select task models and use AI tools."><main className="grid max-w-4xl gap-6 text-sm leading-7 text-[var(--muted-strong)]">
    <Panel className="p-5" id="connections"><PanelHeader eyebrow="AI help" title="Connect providers" />
      <p>In Settings → Connections, save one OpenRouter API key or an OpenAI-compatible endpoint and optional key. Blank key fields keep the configured key. Changes apply immediately. Codex uses the machine’s Codex login; KIE uses KIE_API_KEY in the installation environment. Environment changes require a restart.</p>
      <p>Existing per-task endpoint overrides remain effective. Existing keys remain available when you switch task providers. Graph nodes retain their own provider, model and endpoint choices.</p>
      <p>Claude models can be used when your connected provider offers them, for example through OpenRouter. Media Studio does not have a Claude subscription login integration. A Claude subscription and Claude API billing are separate; a subscription login is not an API key.</p>
      <a href="https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan" target="_blank" rel="noreferrer">Anthropic’s subscription and API billing explanation ↗</a>
    </Panel>
    <Panel className="p-5" id="codex"><PanelHeader eyebrow="Machine connection" title="Codex sign-in" />
      <p>Codex Local has its own row at the top of Connections. Ready means Media Studio can find Codex and its local login. Use Refresh Codex status after signing in; this reads readiness without saving credentials or running a generation.</p>
      <p>If sign-in is needed, make sure Codex is installed on this machine, run <code>codex login</code> in a terminal and finish sign-in, then refresh the status. You do not paste an API key into this row. Once ready, choose a task model in AI Models.</p>
    </Panel>
    <Panel className="p-5" id="models"><PanelHeader eyebrow="AI help" title="Select and test models" />
      <p>In Settings → AI Models, expand Prompt Enhance, Recipe draft model or Media Assistant. Select a connected provider, refresh its model list, choose a model and save that task. Refresh checks the catalog or endpoint; it does not prove generated output quality. The existing saved model remains visible if unavailable. Image / Video Models controls KIE generation models separately.</p>
    </Panel>
    <Panel className="p-5" id="enhancement"><PanelHeader eyebrow="AI help" title="Use Prompt Enhance" />
      <p>Enable Prompt Enhance, select and save its default model, then open Studio. Enter a prompt and click Prompt Enhance to preview a rewrite before applying it. Enable uploaded-image context only with a vision-capable model. Graph prompt nodes choose their models independently.</p>
    </Panel>
    <Panel className="p-5" id="recipes"><PanelHeader eyebrow="AI help" title="Draft and use recipes" />
      <p>Enable recipe drafts and save a drafting model in AI Models. In Presets → Prompt Recipes, describe an idea to generate a first draft. Review the system prompt, variables, image behavior and output format before saving. Drafting does not save a recipe or run image/video generation. Saved recipes can then be selected in compatible Studio and Graph flows.</p>
    </Panel>
    <Link href="/settings/connections">Open Connections →</Link>
  </main></StudioAdminShell>;
}
