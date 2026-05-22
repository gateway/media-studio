export function insertStudioPromptSnippet({
  snippet,
  input,
  prompt,
  setPrompt,
}: {
  snippet: string;
  input: HTMLTextAreaElement | null;
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
}) {
  if (!input) {
    setPrompt((current) => `${current}${current.trim() ? " " : ""}${snippet}`);
    return;
  }
  const start = input.selectionStart ?? prompt.length;
  const end = input.selectionEnd ?? prompt.length;
  const spacerBefore = start > 0 && !/\s$/.test(prompt.slice(0, start)) ? " " : "";
  const spacerAfter = end < prompt.length && !/^\s/.test(prompt.slice(end)) ? " " : "";
  const insertion = `${spacerBefore}${snippet}${spacerAfter}`;
  const nextPrompt = `${prompt.slice(0, start)}${insertion}${prompt.slice(end)}`;
  setPrompt(nextPrompt);
  window.setTimeout(() => {
    input.focus();
    const cursor = start + insertion.length;
    input.setSelectionRange(cursor, cursor);
  }, 0);
}
