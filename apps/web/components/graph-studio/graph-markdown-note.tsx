"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const INLINE_MARKDOWN_PATTERN = /(`[^`]+`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_MARKDOWN_PATTERN.lastIndex = 0;
  while ((match = INLINE_MARKDOWN_PATTERN.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (match[2] && match[3]) {
      const href = match[3];
      nodes.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            window.open(href, "_blank", "noopener,noreferrer");
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {match[2]}
        </a>,
      );
    } else if (match[4]) {
      nodes.push(<strong key={key}>{match[4]}</strong>);
    } else if (match[5]) {
      nodes.push(<em key={key}>{match[5]}</em>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function isFence(line: string) {
  return line.trim().startsWith("```");
}

function isBlockStart(line: string) {
  return /^#{1,4}\s+/.test(line) || /^>\s?/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || isFence(line);
}

export function renderGraphNoteMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (isFence(line)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !isFence(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${index}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = renderInlineMarkdown(heading[2]);
      const Tag = `h${Math.min(level, 4)}` as "h1" | "h2" | "h3" | "h4";
      blocks.push(<Tag key={`heading-${index}`}>{content}</Tag>);
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{quoteLines.map(renderInlineMarkdown).map((item, itemIndex) => <p key={itemIndex}>{item}</p>)}</blockquote>);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ordered-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() && !isBlockStart(lines[index] ?? "")) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(paragraphLines.join(" "))}</p>);
  }
  return blocks;
}

export function GraphMarkdownNoteField({
  value,
  placeholder,
  disabled,
  className,
  onChange,
}: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  className: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(!value.trim());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const selection = selectionRef.current;
    const textarea = textareaRef.current;
    if (!selection || !textarea || document.activeElement !== textarea) return;
    const start = Math.min(selection.start, textarea.value.length);
    const end = Math.min(selection.end, textarea.value.length);
    textarea.setSelectionRange(start, end);
  }, [value]);

  if (editing || !value.trim()) {
    return (
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        aria-label="Note"
        placeholder={placeholder}
        disabled={disabled}
        onBlur={() => setEditing(false)}
        onChange={(event) => {
          selectionRef.current = {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          };
          onChange(event.currentTarget.value);
        }}
      />
    );
  }
  return (
    <div
      className="graph-node-markdown-preview nodrag"
      role="textbox"
      tabIndex={disabled ? -1 : 0}
      aria-label="Note"
      aria-multiline="true"
      aria-readonly="true"
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("a")) {
          return;
        }
        if (!disabled) setEditing(true);
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        setEditing(true);
      }}
    >
      {renderGraphNoteMarkdown(value)}
    </div>
  );
}
