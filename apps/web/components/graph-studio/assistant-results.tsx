"use client";

import { useEffect, useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import type { GraphMediaPreview, GraphWorkflowPayload } from './types';
import { jsonFetch } from './utils/graph-api';

type Result = {
  artifact_id: string; run_id: string; node_title: string; output_port: string; output_index: number;
  node_type?: string; asset_id?: string | null; reference_id?: string | null;
  media_type?: string | null; text?: string | null; url?: string | null;
  available: boolean; blocker?: string | null; version: string;
};
type Results = {
  run_id: string; workflow_name: string; status: string; error?: string | null;
  items: Result[]; selected_artifact_ids: string[];
  selected_result_bindings: Record<string, { run_id: string; version: string }>;
};

export function useAssistantResults({ sessionId, runId, runStatus, workspaceKey, selectionVersion = '{}', enabled }: {
  sessionId: string | null; runId: string | null; runStatus?: string | null; workspaceKey: string; selectionVersion?: string;
  enabled: boolean;
}) {
  const key = `${workspaceKey}:${sessionId}:${runId}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  const [state, setState] = useState<{ key: string; data?: Results; items?: Result[]; error?: string }>({ key });
  const [selecting, setSelecting] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requestVersion = useRef(0);
  useEffect(() => {
    if (!enabled || !sessionId || !runId || selecting) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const version = ++requestVersion.current;
    async function refresh() {
      try {
        const readRun = (id: string) => jsonFetch<Results>(`/api/control/media/assistant/sessions/${encodeURIComponent(sessionId!)}/runs/${encodeURIComponent(id)}/results`);
        const currentRun = await readRun(runId!);
        // Read authoritative bindings: the parent session can lag behind local attachment changes.
        const otherRunIds = [...new Set(Object.values(currentRun.selected_result_bindings).map((binding) => binding.run_id))].filter((id) => id !== runId);
        const runs = [currentRun, ...await Promise.all(otherRunIds.map(readRun))];
        if (!cancelled && requestVersion.current === version) {
          setState({ key, data: runs[0], items: runs.flatMap((run) => run.items) });
          if (['queued', 'pending', 'running'].includes(runs[0].status)) timer = setTimeout(() => void refresh(), 3000);
        }
      } catch (error) {
        if (!cancelled && requestVersion.current === version) setState((current) => ({ ...(current.key === key ? current : { key }), error: (error as Error).message }));
      }
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, sessionId, runId, runStatus, revision, selectionVersion, selecting, enabled]);
  const data = state.key === key ? state.data : undefined;
  const error = state.key === key ? state.error : undefined;
  async function select(item: Result, selected: boolean) {
    if (selecting || !sessionId) return false;
    ++requestVersion.current;
    setSelecting(item.artifact_id);
    try {
      const next = await jsonFetch<Results>(`/api/control/media/assistant/sessions/${encodeURIComponent(sessionId!)}/results/selection`, {
        method: 'POST', body: JSON.stringify({ run_id: item.run_id, artifact_id: item.artifact_id, version: item.version, selected }),
      });
      if (activeKey.current !== key) return false;
      setState((current) => ({ ...current, error: undefined, data: current.data ? { ...current.data, selected_artifact_ids: next.selected_artifact_ids } : undefined }));
      return true;
    } catch (failure) {
      if (activeKey.current === key) setState((current) => ({ ...current, error: (failure as Error).message }));
      return false;
    } finally { setSelecting(null); }
  }
  return {
    data, error, select, busy: Boolean(selecting), visible: Boolean(sessionId && runId),
    status: runStatus ?? data?.status,
    active: ['queued', 'pending', 'running'].includes(runStatus ?? data?.status ?? ''),
    selectedItems: (state.key === key ? state.items ?? [] : []).filter((item) => data?.selected_artifact_ids.includes(item.artifact_id)),
    retry: () => setRevision((value) => value + 1),
  };
}

type ResultController = ReturnType<typeof useAssistantResults>;

export function AssistantResults({ results, workflow, disabled, onOpenPreview, onAsk }: {
  workflow: GraphWorkflowPayload;
  results: ResultController; disabled: boolean;
  onOpenPreview?: (preview: GraphMediaPreview) => void;
  onAsk: () => void;
}) {
  const { data, error } = results;
  if (!results.visible) return null;
  const storyboard = workflow.nodes.some((node) => node.type === 'prompt.recipe'
    && String(node.fields.recipe_id ?? '').includes('storyboard')
    && !['muted', 'frozen'].includes(String((node.metadata?.execution as { mode?: string } | undefined)?.mode)));
  if (results.active) return <section
    className="graph-assistant-message graph-assistant-message-assistant graph-assistant-message-thinking"
    role="status" aria-label="Generation progress" aria-live="polite"
  >
    <strong>{storyboard ? 'Generating your storyboard…' : 'Running your workflow…'}</strong>
    <div className="graph-assistant-thinking">
      <p>You can follow individual steps in the graph.</p>
      <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
    </div>
    {error ? <p role="alert">Result updates are unavailable. Check the graph for run progress.</p> : null}
  </section>;
  const completed = results.status === 'completed' && data?.status === 'completed';
  const items = (data?.items ?? []).filter((item) => !item.node_type?.startsWith('media.load_'));
  const hasMedia = items.some((item) => item.media_type);
  const seen = new Set<string>();
  const outputs = items.filter((item) => {
    if (hasMedia && !item.media_type) return false;
    const key = item.media_type
      ? `${item.media_type}:${item.asset_id || item.reference_id || item.url || item.artifact_id}`
      : item.artifact_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return <section className="graph-assistant-message graph-assistant-message-assistant graph-assistant-results" aria-label="Run results">
    <strong>{completed ? (storyboard ? 'Your storyboard is ready' : 'Your results are ready')
      : results.status === 'failed' ? 'Generation failed'
      : ['cancelled', 'canceled'].includes(results.status ?? '') ? 'Generation stopped'
      : 'Loading results…'}</strong>
    {data?.error ? <p role="alert">{data.error}</p> : null}
    {completed && outputs.length === 0 ? <p>No new output to show. See the graph for details.</p> : null}
    {error ? <div className="graph-assistant-card-actions"><p role="alert">{error}</p><button type="button" disabled={results.busy || disabled} onClick={results.retry}>Try loading results again</button></div> : null}
    {completed ? outputs.map((item, index) => {
      const selected = data.selected_artifact_ids.includes(item.artifact_id);
      return <article key={item.artifact_id} aria-label={`Result ${index + 1}: ${item.node_title}`}>
      <p><strong>{index + 1}. {item.node_title}</strong> · {item.output_port} {item.output_index + 1}</p>
      {item.text != null ? <details><summary>Read completed text</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</pre></details> : null}
      {item.available && item.url && item.media_type === 'image' ? <button
        type="button" className="graph-node-preview-button" disabled={!onOpenPreview}
        aria-label={`Open ${item.node_title} result ${item.output_index + 1} preview`}
        onClick={() => onOpenPreview?.({ mediaType: 'image', url: item.url!, label: `${item.node_title} result ${item.output_index + 1}` })}
      ><img src={item.url} alt={`${item.node_title} result ${item.output_index + 1}`} style={{ maxWidth: '100%' }} /></button> : null}
      {item.available && item.url && item.media_type === 'video' ? <video src={item.url} controls preload="metadata" style={{ maxWidth: '100%' }} /> : null}
      {item.available && item.url && item.media_type === 'audio' ? <audio src={item.url} controls preload="metadata" /> : null}
      {!item.available ? <p>{item.blocker}</p> : null}
      <div className="graph-assistant-card-actions">
        <button type="button" disabled={!item.available || selected || results.busy || disabled}
          aria-label={`${selected ? 'Added to message' : `Ask about this ${item.media_type || 'text'}`} — ${item.node_title}`}
          onClick={async () => { if (await results.select(item, true)) onAsk(); }}>
          {selected ? 'Added to message' : `Ask about this ${item.media_type || 'text'}`}
        </button>
      </div>
    </article>; }) : null}
  </section>;
}

export function AssistantResultAttachments({ results, disabled, onOpenPreview }: {
  results: ResultController; disabled: boolean; onOpenPreview?: (preview: GraphMediaPreview) => void;
}) {
  if (results.active || !results.selectedItems.length) return null;
  return <section className="graph-assistant-result-attachments" aria-label="Results to discuss">
    <p>Ask a question about:</p>
    <div className="graph-assistant-result-attachment-list">
      {results.selectedItems.map((item) => <div className="graph-assistant-result-attachment" key={item.artifact_id}>
        {item.available && item.url && item.media_type === 'image' ? <button type="button" className="graph-assistant-result-thumbnail"
          aria-label={`Preview attached result: ${item.node_title}`} disabled={!onOpenPreview}
          onClick={() => onOpenPreview?.({ mediaType: 'image', url: item.url!, label: item.node_title })}>
          <img src={item.url} alt="" />
        </button> : <FileText size={18} aria-hidden="true" />}
        <div>{item.node_title}{!item.available ? ' (unavailable)' : ''}</div>
        <button type="button" className="graph-assistant-result-remove" disabled={results.busy || disabled}
          aria-label={`Remove from message: ${item.node_title}`} title="Remove from message"
          onClick={() => void results.select(item, false)}><X size={14} aria-hidden="true" /></button>
      </div>)}
    </div>
  </section>;
}

export function AssistantRunScope({ workflow }: { workflow: GraphWorkflowPayload }) {
  return <details><summary>Review models, inputs and work to run ({workflow.nodes.length} nodes)</summary>
    <ul>{workflow.nodes.map((node) => {
      const execution = node.metadata?.execution as { mode?: string; cached_run_id?: string } | undefined;
      const source = node.metadata?.source_result as { artifact_id?: string } | undefined;
      const ui = node.metadata?.ui as { customTitle?: string } | undefined;
      const fields = Object.entries(node.fields).filter(([key, value]) => /^(model_key|model|provider|asset_id|reference_id|duration|duration_seconds|aspect_ratio|resolution)$/.test(key) && value != null && value !== '');
      return <li key={node.id}><strong>{ui?.customTitle || node.type}</strong> · {node.type} · {execution?.mode === 'frozen' ? 'Reuse frozen output' : execution?.mode === 'muted' ? 'Muted' : source ? 'Load completed result' : 'Execute'}
        {execution?.cached_run_id ? <div>Cached run: {execution.cached_run_id}</div> : null}
        {source?.artifact_id ? <div>Completed output: {source.artifact_id}</div> : null}
        {fields.map(([key, value]) => <div key={key}>{key.replaceAll('_', ' ')}: {String(value)}</div>)}
      </li>;
    })}</ul>
  </details>;
}
