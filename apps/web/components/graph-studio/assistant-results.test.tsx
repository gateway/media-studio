// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantResults } from './assistant-results';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const first = { artifact_id: 'first', run_id: 'run-a', node_title: 'Portrait direction', output_port: 'text', output_index: 0, text: 'Portrait: warm window light', available: true, version: 'v1' };
const second = { ...first, artifact_id: 'second', node_title: 'Environment direction', text: 'Environment: misty pine forest', version: 'v2' };
const response = { run_id: 'run-a', workflow_name: 'Directions', status: 'completed', items: [first, second], selected_artifact_ids: [] };
it('shows completed text without a reasoning turn and selects the exact second result', async () => {
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      requests.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ...response, selected_artifact_ids: ['second'] }), { status: 200 });
    }
    return new Response(JSON.stringify(response), { status: 200 });
  }));
  const view = render(<AssistantResults sessionId="s-a" runId="run-a" runStatus="completed" workspaceKey="a" />);
  expect(await screen.findByText('Environment: misty pine forest')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use result 2' }));
  expect(await screen.findByRole('button', { name: 'Remove result 2' })).toBeTruthy();
  expect(requests).toEqual([{ run_id: 'run-a', artifact_id: 'second', version: 'v2', selected: true }]);
  view.rerender(<AssistantResults sessionId="s-a" runId="run-a" runStatus="completed" workspaceKey="a" />);
  await waitFor(() => expect(screen.getAllByText('Environment: misty pine forest')).toHaveLength(1));
});

it('keeps missing images unselectable, renders video metadata controls, and restores selection', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...response, selected_artifact_ids: ['video'], items: [
    { ...first, text: null, media_type: 'image', url: null, available: false, blocker: 'Media file is missing.' },
    { ...second, artifact_id: 'video', text: null, media_type: 'video', url: '/api/control/files/existing.mp4' },
  ] }), { status: 200 })));
  render(<AssistantResults sessionId="s-a" runId="run-a" runStatus="failed" workspaceKey="a" />);
  expect(await screen.findByText('Media file is missing.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Use result 1' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Remove result 2' })).toBeTruthy();
  expect(document.querySelector('video')?.getAttribute('preload')).toBe('metadata');
  expect(document.querySelector('video')?.getAttribute('autoplay')).toBeNull();
});

it('does not deliver an old workspace response into another conversation', async () => {
  let finish: (value: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/s-a/')
    ? new Promise<Response>((resolve) => { finish = resolve; })
    : Promise.resolve(new Response(JSON.stringify({ ...response, items: [{ ...second, text: 'Other conversation' }] }), { status: 200 }))));
  const view = render(<AssistantResults sessionId="s-a" runId="run-a" runStatus="completed" workspaceKey="a" />);
  view.rerender(<AssistantResults sessionId="s-b" runId="run-b" runStatus="completed" workspaceKey="b" />);
  expect(await screen.findByText('Other conversation')).toBeTruthy();
  finish(new Response(JSON.stringify(response), { status: 200 }));
  await waitFor(() => expect(screen.queryByText('Portrait: warm window light')).toBeNull());
});

it('lets the user remove a selected missing result and clear orphaned selections', async () => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method) requests.push(init.method);
    return new Response(JSON.stringify({ ...response, items: [{ ...first, available: false }], selected_artifact_ids: requests.length ? [] : ['first', 'orphan'] }), { status: 200 });
  }));
  render(<AssistantResults sessionId="s-a" runId="run-a" runStatus="completed" workspaceKey="a" />);
  const remove = await screen.findByRole('button', { name: 'Remove result 1' });
  expect((remove as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Clear selected results' }));
  await waitFor(() => expect(requests).toEqual(['DELETE']));
  expect(await screen.findByRole('button', { name: 'Use result 1' })).toBeTruthy();
});

it('refreshes cards when the assistant selects a result through conversation', async () => {
  let selected: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...response, selected_artifact_ids: selected }), { status: 200 })));
  const view = render(<AssistantResults sessionId="s-a" runId="run-a" workspaceKey="a" selectionVersion="none" />);
  expect(await screen.findByRole('button', { name: 'Use result 2' })).toBeTruthy();
  selected = ['second'];
  view.rerender(<AssistantResults sessionId="s-a" runId="run-a" workspaceKey="a" selectionVersion="second-v2" />);
  expect(await screen.findByRole('button', { name: 'Remove result 2' })).toBeTruthy();
});
