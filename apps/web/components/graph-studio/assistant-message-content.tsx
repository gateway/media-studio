import type { ReactElement } from "react";

function renderInlineAssistantMarkdown(text: string, keyPrefix: string) {
  return text.split(/(`[^`\n]+`|!\[[^\]\n]*\]\([^\n)]*\)|\[[^\]\n]+\]\(https?:\/\/(?:[^\s()]|\([^\s()]*\))+\)|\*\*[^*]+\*\*|\*[^*]+\*)/gi).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${keyPrefix}-code-${index}`}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("![")) return part;
    const link = part.match(/^\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)$/i);
    if (link) {
      return <a key={`${keyPrefix}-link-${index}`} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-strong-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={`${keyPrefix}-em-${index}`}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export function AssistantMessageContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactElement[] = [];
  let paragraphLines: string[] = [];
  let listItems: Array<{ text: string; number?: number }> = [];
  let listKind: "ul" | "ol" | null = null;
  let literalLines: string[] | null = null;
  let fenceMarker = "";

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const value = paragraphLines.join("\n");
    if (value) {
      blocks.push(<p key={`p-${blocks.length}`}>{renderInlineAssistantMarkdown(value, `p-${blocks.length}`)}</p>);
    }
    paragraphLines = [];
  };
  const flushList = () => {
    if (!listItems.length || !listKind) return;
    const ListTag = listKind;
    blocks.push(
      <ListTag key={`list-${blocks.length}`}>
        {listItems.map((item, index) => (
          <li key={`${listKind}-${index}`} value={item.number}>{renderInlineAssistantMarkdown(item.text, `${listKind}-${index}`)}</li>
        ))}
      </ListTag>,
    );
    listItems = [];
    listKind = null;
  };

  const flushLiteral = () => {
    if (literalLines) blocks.push(<pre key={`literal-${blocks.length}`}>{literalLines.join("\n")}</pre>);
    literalLines = null;
  };

  lines.forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (literalLines) {
      literalLines.push(rawLine);
      if (/^`+$/.test(trimmed) && trimmed.length >= fenceMarker.length) flushLiteral();
      return;
    }
    const fence = rawLine.match(/^ {0,3}(`{3,})(?:[a-zA-Z0-9_-]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      literalLines = [rawLine];
      fenceMarker = fence[1];
      return;
    }
    const line = rawLine;
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listKind !== "ul") flushList();
      listKind = "ul";
      listItems.push({ text: unordered[1] });
      return;
    }
    // Native list values are signed 32-bit integers; keep other labels as source.
    const number = ordered ? Number(ordered[1]) : null;
    if (ordered && number !== null && number <= 2147483647 && String(number) === ordered[1]) {
      flushParagraph();
      if (listKind !== "ol") flushList();
      listKind = "ol";
      listItems.push({ text: ordered[2], number });
      return;
    }
    flushList();
    paragraphLines.push(line);
  });
  flushParagraph();
  flushList();
  flushLiteral();

  return <div className="graph-assistant-message-content">{blocks.length ? blocks : <p>{text}</p>}</div>;
}
