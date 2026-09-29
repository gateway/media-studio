type RecordedRun = {
  run_id: string; status: string; error?: string; created_at?: string; finished_at?: string;
};

function recordedFailures(content: Record<string, unknown> | undefined): RecordedRun[] {
  const turn = content?.kernel_turn as { artifacts?: { kind?: string; data?: { run?: Partial<RecordedRun> } }[] } | undefined;
  const runs = new Map<string, RecordedRun>();
  for (const artifact of Array.isArray(turn?.artifacts) ? turn.artifacts : []) {
    const run = artifact?.data?.run;
    if (artifact?.kind !== 'run_evidence' || typeof run?.run_id !== 'string'
      || !['failed', 'cancelled', 'canceled'].includes(run.status ?? '')) continue;
    runs.set(run.run_id, {
      run_id: run.run_id, status: run.status!,
      error: typeof run.error === 'string' ? run.error : undefined,
      created_at: typeof run.created_at === 'string' ? run.created_at : undefined,
      finished_at: typeof run.finished_at === 'string' ? run.finished_at : undefined,
    });
  }
  return [...runs.values()];
}

export function AssistantRunEvidence({ content }: { content: Record<string, unknown> | undefined }) {
  return recordedFailures(content).map((run) => {
    const timestamp = run.finished_at || run.created_at;
    const date = timestamp ? new Date(timestamp) : null;
    return <section key={run.run_id} aria-label="Recorded run outcome" className="graph-assistant-activity-item">
      <strong>{run.status === 'failed' ? 'Recorded run failed' : 'Recorded run stopped'}</strong>
      {date && !Number.isNaN(date.getTime()) ? <p><time dateTime={timestamp}>{date.toLocaleString()}</time></p> : null}
      <p>This is a past run outcome. Current readiness is checked separately; viewing this does not start a run.</p>
      <details><summary>Run details</summary>
        <p>Run: <code>{run.run_id}</code></p>
        {run.error ? <p>{run.error}</p> : <p>No failure detail was recorded.</p>}
      </details>
    </section>;
  });
}
