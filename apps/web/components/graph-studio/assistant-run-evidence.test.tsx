// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AssistantRunEvidence } from './assistant-run-evidence';

afterEach(cleanup);
const run = { run_id: 'earlier-run', status: 'failed', created_at: '2026-09-26T05:57:00Z', error: 'panel sequence is empty' };
const content = (runs: unknown[]) => ({ kernel_turn: { artifacts: runs.map((value) => ({ kind: 'run_evidence', data: { run: value } })) } });

it('keeps the dated recorded failure and its exact identity separate from current readiness', () => {
  const view = render(<AssistantRunEvidence content={content([run, run])} />);
  expect(screen.getAllByRole('region', { name: 'Recorded run outcome' })).toHaveLength(1);
  expect(screen.getByText('Recorded run failed')).toBeTruthy();
  expect(view.container.querySelector('time')?.dateTime).toBe(run.created_at);
  fireEvent.click(screen.getByText('Run details'));
  expect(screen.getByText('earlier-run')).toBeTruthy();
  expect(screen.getByText('panel sequence is empty')).toBeTruthy();
  expect(screen.getByText(/Current readiness is checked separately/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /run|retry/i })).toBeNull();
});

it('does not turn arbitrary prose or unrelated artifacts into run evidence', () => {
  const view = render(<AssistantRunEvidence content={{ reply: 'Generation failed', kernel_turn: { artifacts: [{ kind: 'graph_proposal', data: { run } }] } }} />);
  expect(view.container.textContent).toBe('');
});

it.each(['running', 'completed'])('does not present a %s snapshot as historical failure', (status) => {
  const view = render(<AssistantRunEvidence content={content([{ ...run, status }])} />);
  expect(view.container.textContent).toBe('');
});

it('retains stopped outcomes without inventing a date or failure reason', () => {
  const view = render(<AssistantRunEvidence content={content([{ run_id: 'stopped-run', status: 'cancelled', created_at: 'invalid' }])} />);
  expect(screen.getByText('Recorded run stopped')).toBeTruthy();
  expect(view.container.querySelector('time')).toBeNull();
  expect(screen.getByText('No failure detail was recorded.')).toBeTruthy();
});
