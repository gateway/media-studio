// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantResults, AssistantResultAttachments, useAssistantResults } from './assistant-results';
import type { GraphWorkflowPayload } from './types';
const workflow = { schema_version: 1, name: 'Commercial', nodes: [{ id: 'recipe', type: 'prompt.recipe', position: { x: 0, y: 0 }, fields: { recipe_id: 'prompt-recipe-storyboard-v2' }, metadata: {} }], edges: [], metadata: {} } as GraphWorkflowPayload;
const image = { artifact_id: 'image', run_id: 'run-a', node_type: 'model.image', node_title: 'Finished storyboard', output_port: 'image', output_index: 0, media_type: 'image', asset_id: 'new-image', url: '/image.png', available: true, version: 'v1' };
const reference = { ...image, artifact_id: 'reference', node_type: 'media.load_image', node_title: 'Original host', asset_id: 'original', url: '/original.png' };
const text = { artifact_id: 'text', run_id: 'run-a', node_type: 'prompt.recipe', node_title: 'Recipe', output_port: 'text', output_index: 0, text: 'Complete recipe prompt', available: true, version: 'v2' };
const response = { run_id: 'run-a', workflow_name: 'Commercial', status: 'completed', items: [reference, text, image, { ...image, artifact_id: 'preview', node_type: 'preview.image' }], selected_artifact_ids: [] as string[], selected_result_bindings: {} };
const onAsk = vi.fn();
function Harness({ status, workspace = 'a', graph = workflow }: { status?: string; workspace?: string; graph?: GraphWorkflowPayload }) {
  const results = useAssistantResults({ sessionId: 's-' + workspace, runId: 'run-' + workspace, runStatus: status, workspaceKey: workspace, enabled: true });
  return <><AssistantResults results={results} workflow={graph} disabled={false} onAsk={onAsk} onOpenPreview={vi.fn()} /><AssistantResultAttachments results={results} disabled={false} /></>;
}
const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it.each(['queued', 'pending', 'running'])('shows only progress during %s despite reference results and selections', async (status) => {
  const fetcher = vi.fn(async () => reply({ ...response, status, items: [reference, text], selected_artifact_ids: ['reference'] }));
  vi.stubGlobal('fetch', fetcher); render(<Harness status={status} />);
  expect(screen.getByRole('status').textContent).toContain('Generating your storyboard…');
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: /Use in chat/ })).toBeNull();
  expect(screen.queryByText('Complete recipe prompt')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Media in this conversation' })).toBeNull();
});
it('shows one new image on completion and hides it immediately when running again', async () => {
  let status = 'running'; vi.stubGlobal('fetch', vi.fn(async () => reply({ ...response, status })));
  const view = render(<Harness status="running" />);
  status = 'completed'; view.rerender(<Harness status="completed" />);
  expect(await screen.findByRole('button', { name: 'Use in chat — Finished storyboard' })).toBeTruthy();
  expect(screen.getByText('Your storyboard is ready')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull(); expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.queryByText(/Original host/)).toBeNull(); expect(screen.queryByText('Complete recipe prompt')).toBeNull();
  view.rerender(<Harness status="running" />);
  expect(screen.getByRole('status')).toBeTruthy(); expect(screen.queryByRole('img')).toBeNull();
});
it.each(['failed', 'cancelled'])('shows terminal %s without review controls', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async () => reply({ ...response, status, error: status === 'failed' ? 'Provider rejected the request.' : null })));
  render(<Harness status={status} />);
  expect(screen.getByText(status === 'failed' ? 'Generation failed' : 'Generation stopped')).toBeTruthy();
  if (status === 'failed') expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Provider rejected the request.');
  expect(screen.queryByRole('status')).toBeNull(); expect(screen.queryByRole('button', { name: /Use in chat/ })).toBeNull();
});
it('keeps polling failure separate from generation failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Offline'); })); render(<Harness status="running" />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Result updates are unavailable. Check the graph for run progress.');
  expect(screen.getByRole('status').textContent).toContain('Generating your storyboard'); expect(screen.queryByText('Generation failed')).toBeNull();
});
it('selects the exact completed image version without starting a run', async () => {
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { requests.push(JSON.parse(String(init.body))); return reply({ ...response, selected_artifact_ids: ['image'] }); }
    return reply(response);
  })); render(<Harness status="completed" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use in chat — Finished storyboard' }));
  expect(await screen.findByRole('button', { name: 'In this conversation — Finished storyboard' })).toBeTruthy();
  expect(requests).toEqual([{ run_id: 'run-a', artifact_id: 'image', version: 'v1', selected: true }]); expect(onAsk).toHaveBeenCalledOnce();
});
it('preserves text-only outputs and generic workflow progress', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply({ ...response, items: [text] })));
  const graph = { ...workflow, nodes: [] }; const view = render(<Harness status="running" graph={graph} />);
  expect(screen.getByText('Running your workflow…')).toBeTruthy(); view.rerender(<Harness status="completed" graph={graph} />);
  expect(await screen.findByText('Complete recipe prompt')).toBeTruthy();
});
it('ignores stale responses from a different workspace', async () => {
  let finish: (value: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/s-a/') ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(reply({ ...response, items: [{ ...text, text: 'Other output' }] }))));
  const view = render(<Harness status="completed" />); view.rerender(<Harness status="completed" workspace="b" />);
  expect(await screen.findByText('Other output')).toBeTruthy(); finish(reply(response));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Use in chat — Finished storyboard' })).toBeNull());
});
it('keeps missing media unselectable and video non-autoplaying', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply({ ...response, items: [{ ...image, available: false, url: null, blocker: 'Media file is missing.' }, { ...image, artifact_id: 'video', asset_id: 'video', node_title: 'Final video', media_type: 'video', url: '/video.mp4' }] })));
  render(<Harness status="completed" />); expect(await screen.findByText('Media file is missing.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Use in chat — Finished storyboard' })).toHaveProperty('disabled', true);
  expect(document.querySelector('video')?.getAttribute('preload')).toBe('metadata'); expect(document.querySelector('video')?.getAttribute('autoplay')).toBeNull();
});

it('explains selection, shows its count, and removes context without deleting media or sending a message', async () => {
  let selected: string[] = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') selected = JSON.parse(String(init.body)).selected ? ['image'] : [];
    return reply({ ...response, selected_artifact_ids: selected });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<Harness status="completed" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use in chat — Finished storyboard' }));
  expect(await screen.findByText('In this conversation · 1')).toBeTruthy();
  expect(screen.getByText('Choose Use in chat, then ask a question or describe a change.')).toBeTruthy();
  expect(onAsk).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Remove from conversation: Finished storyboard' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Media in this conversation' })).toBeNull());
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes.map(([url]) => url)).toEqual(['/api/control/media/assistant/sessions/s-a/results/selection', '/api/control/media/assistant/sessions/s-a/results/selection']);
  expect(JSON.parse(String(writes[1][1]?.body))).toEqual({ run_id: 'run-a', artifact_id: 'image', version: 'v1', selected: false });
  expect(screen.getByRole('button', { name: 'Use in chat — Finished storyboard' })).toHaveProperty('disabled', false);
});
