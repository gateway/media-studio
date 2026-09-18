"use client";

import { useEffect, useRef, useState } from 'react';
import type { GraphMediaPreview, GraphWorkflowPayload } from './types';
import { jsonFetch } from './utils/graph-api';

type Result = {
  artifact_id: string; run_id: string; node_title: string; output_port: string; output_index: number;
  media_type?: string | null; text?: string | null; url?: string | null;
  available: boolean; blocker?: string | null; version: string;
};
type Results = {
  run_id: string; workflow_name: string; status: string; error?: string | null;
  items: Result[]; selected_artifact_ids: string[];
};

export function AssistantResults({ sessionId, runId, runStatus, workspaceKey, selectionVersion, onOpenPreview }: {
  sessionId: string | null; runId: string | null; runStatus?: string | null; workspaceKey: string; selectionVersion?: string;
  onOpenPreview?: (preview: GraphMediaPreview) => void;
}) {
  const key = `${workspaceKey}:${sessionId}:${runId}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  const [state, setState] = useState<{ key: string; data?: Results; error?: string }>({ key });
  const [selecting, setSelecting] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!sessionId || !runId) return;
    let cancelled = false;
    void jsonFetch<Results>(`/api/control/media/assistant/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/results`)
      .then((data) => { if (!cancelled) setState({ key, data }); })
      .catch((error: Error) => { if (!cancelled) setState({ key, error: error.message }); });
    return () => { cancelled = true; };
  }, [key, sessionId, runId, runStatus, revision, selectionVersion]);
  const data = state.key === key ? state.data : undefined;
  const error = state.key === key ? state.error : undefined;
  if (!sessionId || !runId) return null;
  async function clearSelection() {
    if (selecting) return;
    setSelecting('clear');
    try {
      await jsonFetch(`/api/control/media/assistant/sessions/${encodeURIComponent(sessionId!)}/results/selection`, { method: 'DELETE' });
      if (activeKey.current === key) {
        setState({ key, data: data ? { ...data, selected_artifact_ids: [] } : undefined });
        setRevision((value) => value + 1);
      }
    } catch (failure) {
      if (activeKey.current === key) setState({ key, data, error: (failure as Error).message });
    } finally { setSelecting(null); }
  }
  async function select(item: Result) {
    if (selecting) return;
    setSelecting(item.artifact_id);
    try {
      const next = await jsonFetch<Results>(`/api/control/media/assistant/sessions/${encodeURIComponent(sessionId!)}/results/selection`, {
        method: 'POST', body: JSON.stringify({ run_id: runId, artifact_id: item.artifact_id, version: item.version, selected: !data?.selected_artifact_ids.includes(item.artifact_id) }),
      });
      if (activeKey.current === key) setState({ key, data: next });
    } catch (failure) {
      if (activeKey.current === key) setState({ key, data, error: (failure as Error).message });
    } finally { setSelecting(null); }
  }
  return <section className="graph-assistant-message graph-assistant-message-assistant graph-assistant-results" aria-label="Run results">
    <strong>{data?.workflow_name || 'Graph results'} · {data?.status || runStatus || 'Loading'}</strong>
    <p>The assistant can review or reuse checked results when you send a message. Checking a box does not start a run. Click an image to enlarge it.</p>
    {data?.error ? <p>{data.error}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {data?.items.map((item, index) => {
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
      <label className="graph-assistant-result-selection">
        <input type="checkbox" checked={selected}
          disabled={(!item.available && !selected) || Boolean(selecting)}
          aria-label={`Include with my message — result ${index + 1}: ${item.node_title}`}
          onChange={() => void select(item)} />
        Include with my message
      </label>
    </article>; })}
    {data?.selected_artifact_ids.length ? <p>{data.selected_artifact_ids.length} {data.selected_artifact_ids.length === 1 ? 'result' : 'results'} included. Tell the assistant what you want to do with {data.selected_artifact_ids.length === 1 ? 'it' : 'them'}.</p> : null}
    <div className="graph-assistant-card-actions graph-assistant-result-tools">
      <button type="button" disabled={!data?.selected_artifact_ids.length || Boolean(selecting)} onClick={() => void clearSelection()}>Clear selection</button>
      <button type="button" disabled={Boolean(selecting)} onClick={() => setRevision((value) => value + 1)}>Check for new results</button>
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
