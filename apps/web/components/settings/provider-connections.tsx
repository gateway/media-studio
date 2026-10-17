"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/status-pill";
import { buildStudioScopedHref } from "@/lib/studio-navigation";
import { AdminButton, AdminField, AdminInput } from "@/components/admin-controls";
import { AdminActionNotice } from "@/components/admin-action-notice";
import { Panel, PanelHeader } from "@/components/panel";
import { llmCredentialSourceLabel, llmProviderLabel, type SharedLlmProviderKind } from "@/lib/llm-provider-metadata";
import { invalidateProviderModelCatalogs } from "@/hooks/use-shared-provider-model-catalog";

export type ProviderConnection = {
  provider_kind: SharedLlmProviderKind;
  configured: boolean;
  api_key_configured: boolean;
  credential_source: string | null;
  base_url: string | null;
};

function ConnectionForm({ connection }: { connection: ProviderConnection }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(connection.base_url ?? "");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/control/media/provider-connections/${connection.provider_kind}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: baseUrl, ...(apiKey.trim() ? { api_key: apiKey } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not save connection.");
      setApiKey("");
      invalidateProviderModelCatalogs();
      window.dispatchEvent(new Event("provider-connections-changed"));
      setNotice({ ok: true, text: "Connection saved. Choose and test task models in AI Models." });
      router.refresh();
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "Could not save connection." });
    } finally { setSaving(false); }
  }
  return <Panel className="p-5">
    <PanelHeader eyebrow="Provider connection" title={llmProviderLabel(connection.provider_kind)} description={connection.credential_source ? llmCredentialSourceLabel(connection.credential_source) : "Add your endpoint and credentials below."} action={<StatusPill label={connection.configured ? "Configured" : "Not configured"} tone={connection.configured ? "healthy" : "neutral"} />} />
    <form className="mt-4 grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="grid gap-4 md:grid-cols-2">
      <AdminField label="API key"><AdminInput type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connection.api_key_configured ? "Leave blank to keep the configured key" : connection.provider_kind === "openrouter" ? "OpenRouter API key" : "Optional local server API key"} /></AdminField>
      <AdminField label="API base URL"><AdminInput type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></AdminField>
      </div>
      <p className="text-sm text-[var(--muted-strong)]">Saved once for AI tasks and graph prompt nodes. Existing task endpoint overrides remain in effect. Keys stay on the server.</p>
      {notice ? <AdminActionNotice tone={notice.ok ? "healthy" : "danger"} text={notice.text} /> : null}
      <AdminButton type="submit" disabled={saving} size="compact" className="justify-self-start">{saving ? "Saving…" : `Save ${llmProviderLabel(connection.provider_kind)} connection`}</AdminButton>
    </form>
  </Panel>;
}

export function ProviderConnections({ connections, currentProjectId = null }: { connections: ProviderConnection[]; currentProjectId?: string | null }) {
  const router = useRouter();
  const codex = connections.find((connection) => connection.provider_kind === "codex_local");
  return <div className="grid gap-4">
    {codex ? <Panel className="p-5">
      <PanelHeader
        eyebrow="Machine connection"
        title="Codex Local"
        description="Uses the Codex login on this machine. No API key to enter here."
        action={<StatusPill label={codex.configured ? "Ready" : "Sign-in needed"} tone={codex.configured ? "healthy" : "warning"} />}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <AdminButton size="compact" variant="subtle" onClick={() => router.refresh()}>Refresh Codex status</AdminButton>
        <Link href={buildStudioScopedHref("/settings/llms", currentProjectId)} className="text-sm text-[var(--accent-strong)]">Choose task models →</Link>
        <a href="/help/ai#codex" target="_blank" rel="noreferrer" className="text-sm text-[var(--accent-strong)]">Codex sign-in help ↗</a>
      </div>
    </Panel> : null}
    {connections.filter((item) => item.provider_kind !== "codex_local").map((connection) => <ConnectionForm key={connection.provider_kind} connection={connection} />)}
  </div>;
}
