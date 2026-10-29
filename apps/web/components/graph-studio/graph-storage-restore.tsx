import type { GraphStorageChoice } from "./utils/graph-storage-identity";

type Props = {
  choices: GraphStorageChoice[];
  onChoose: (scope: string) => void;
  error: string | null;
  onRetry: () => void;
  canRetry: boolean;
};

export function GraphStorageRestore({
  choices,
  onChoose,
  error,
  onRetry,
  canRetry,
}: Props) {
  return (
    <main
      className="graph-studio-shell graph-unsupported-shell graph-storage-restore"
      aria-label="Restoring workflows"
    >
      <section className="graph-unsupported-panel" role="status">
        {choices.length ? (
          <>
            <h1>Choose your workflow workspace</h1>
            <p>
              Earlier offline drafts and this installation have separate
              workspaces. Choose which to open. Both remain saved; nothing will
              be merged or deleted.
            </p>
            {choices.map((choice) => (
              <button
                key={choice.scope}
                type="button"
                onClick={() => onChoose(choice.scope)}
              >
                {choice.label} ({choice.tabCount} workflows)
              </button>
            ))}
          </>
        ) : (
          <>
            <p>{error ?? "Restoring your workflows…"}</p>
            {error && canRetry && (
              <button type="button" onClick={onRetry}>
                Retry
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
