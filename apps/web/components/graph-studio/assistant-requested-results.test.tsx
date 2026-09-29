// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantRequestedResult, requestedResultBindings, useAssistantResults } from './assistant-results';

const binding = { run_id: 'original-run', artifact_id: 'original', version: 'v1' };
const original = { ...binding, node_title: 'Original storyboard', output_port: 'image', output_index: 0, media_type: 'image', available: true, url: '/original.png' };
const response = { run_id: 'current-run', status: 'completed', items: [{ ...original, run_id: 'current-run', artifact_id: 'nighttime', url: '/nighttime.png' }], selected_artifact_ids: [], selected_result_bindings: {} };
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const onAsk = vi.fn(); const onPreview = vi.fn();
function Harness({ session = 'session', runId = 'current-run' as string | null }) {
  const results = useAssistantResults({ sessionId: session, runId, workspaceKey: session, enabled: true, requestedResults: [binding] });
  return <AssistantRequestedResult binding={binding} results={results} disabled={false} onAsk={onAsk} onOpenPreview={onPreview} />;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('displays the exact historical image and selects it only on explicit action', async () => {
  let selected = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { expect(JSON.parse(String(init.body))).toEqual({ ...binding, selected: true }); selected = true; }
    return reply({ ...response, items: url.includes('original-run') ? [original] : response.items,
      selected_artifact_ids: selected ? ['original'] : [], selected_result_bindings: selected ? { original: binding } : {} });
  });
  vi.stubGlobal('fetch', fetcher); render(<Harness />);
  const preview = await screen.findByRole('button', { name: 'Open Original storyboard result 1 preview' });
  expect(screen.getByRole('img').getAttribute('src')).toBe('/original.png');
  expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  fireEvent.click(preview); expect(onPreview).toHaveBeenCalledWith({ mediaType: 'image', url: '/original.png', label: 'Original storyboard result 1' });
  fireEvent.click(screen.getByRole('button', { name: 'Use in chat — Original storyboard' }));
  expect(await screen.findByRole('button', { name: 'In this conversation — Original storyboard' })).toBeTruthy();
  expect(onAsk).toHaveBeenCalledOnce();
});

it.each(['stale', 'missing', 'unavailable', 'foreign'])('never displays substituted or broken media when %s', async (condition) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!url.includes('original-run')) return reply(response);
    if (condition === 'foreign') return new Response(JSON.stringify({ detail: 'This run does not belong to this conversation.' }), { status: 409 });
    return reply({ ...response, items: condition === 'missing' ? [] : [{ ...original, version: condition === 'stale' ? 'v2' : 'v1', available: condition !== 'unavailable' }] });
  }));
  render(<Harness />); expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByRole('button', { name: /Use in chat/ })).toBeNull();
});

it('can show a historical result without a current canvas run', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply({ ...response, run_id: 'original-run', items: [original] })));
  render(<Harness runId={null} />); expect(await screen.findByRole('img')).toHaveProperty('src', 'http://localhost:3000/original.png');
});

it('does not expose a previous conversation while the next one is loading', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/other/') ? new Promise<Response>(() => {}) : Promise.resolve(reply({ ...response, items: [original] }))));
  const view = render(<Harness />); await screen.findByRole('img'); view.rerender(<Harness session="other" />);
  await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
});

it('accepts only typed display artifacts, not raw image Markdown or arbitrary URLs', () => {
  expect(requestedResultBindings({ kernel_turn: { artifacts: [{ kind: 'result_display', data: binding }] } })).toEqual([binding]);
  expect(requestedResultBindings({ kernel_turn: { artifacts: [{ kind: 'result_display', data: { url: 'https://example.test/a.png' } }] } })).toEqual([]);
  expect(requestedResultBindings({ reply: '![image](/image.png)' })).toEqual([]);
});
