// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { assistantJsonResponse as json, assistantIdleProgress as idle, assistantTestSession as session, assistantTestWorkflow as workflow } from "./creative-assistant-test-fixtures";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(text: string, kernel = true) {
  const saved = {...session, messages: [{assistant_message_id: "formatting", role: "assistant", content_text: text,
    content_json: kernel ? {mode: "assistant_kernel", next_action: {kind: "none"}} : {}}]};
  vi.stubGlobal("fetch", vi.fn((url: string) => json(url.endsWith("/progress") ? idle : url.endsWith("/session-1") ? saved : {ready: true})));
  return render(<CreativeAssistantPanel open workspaceKey="formatting" initialAssistantSessionId="session-1"
    workflowId="workflow-1" workflowName="Graph" workflow={workflow} references={[]} importImageFile={vi.fn()}
    onApplyWorkflow={vi.fn()} onRunWorkflow={vi.fn()} onClose={vi.fn()}/>);
}

it("preserves noncontiguous author numbers and explicit shot labels without inventing another sequence", async () => {
  mount("7. Establish the room.\n12. Return to the cup.\n\nShot 03: Preserve the action.\nScene 12: Keep the light.");
  const messages = await screen.findByRole("region", {name: "Assistant messages"});
  expect(Array.from(messages.querySelectorAll("ol li")).map(item => item.getAttribute("value"))).toEqual(["7", "12"]);
  expect(messages.textContent).toContain("Shot 03: Preserve the action.");
  expect(messages.textContent).toContain("Scene 12: Keep the light.");
  expect(messages.querySelectorAll("ol li")).toHaveLength(2);
});

it.each([true, false])("preserves authored prose, hard line breaks and literal punctuation for kernel=%s", async kernel => {
  const text = "Keep Lens - 40mm and take 7. Preserve every word.\n  Shot 03 stays on this line with two leading spaces.";
  mount(text, kernel);
  const messages = await screen.findByRole("region", {name: "Assistant messages"});
  expect(messages.querySelector(".graph-assistant-message-content")?.textContent).toBe(text);
  expect(messages.querySelector("li")).toBeNull();
});

it("keeps inline and fenced code literal, including whitespace, emphasis markers and list-like lines", async () => {
  const literal = "  **literal stars**  \n7. preserve this code line\n\n<script>literal only</script>";
  const fenced = ["```text", literal, "```"].join("\n");
  mount("Inline `**keep stars**` and `7. keep number`.\n\n" + fenced);
  const messages = await screen.findByRole("region", {name: "Assistant messages"});
  expect(messages.querySelector("pre")?.textContent).toBe(fenced);
  expect(messages.querySelector("code")?.textContent).toBe("**keep stars**");
  expect(messages.querySelector(".graph-assistant-message-content strong")).toBeNull();
  expect(messages.querySelector("li")).toBeNull();
  expect(messages.querySelector("script")).toBeNull();
});

it("degrades headings, tables and nested-looking lists to readable source text without flattening structure", async () => {
  const text = "# Unsupported heading\n\n| Field | Value |\n| --- | --- |\n| Lens | 40mm |\n\n  - Nested-looking line\n    - Keep this indentation";
  mount(text);
  const messages = await screen.findByRole("region", {name: "Assistant messages"});
  expect(messages.textContent).toContain("| Field | Value |\n| --- | --- |\n| Lens | 40mm |");
  expect(messages.textContent).toContain("  - Nested-looking line\n    - Keep this indentation");
  expect(messages.querySelector("h1,table,li")).toBeNull();
});

it("renders only explicit HTTP(S) links as accessible native links, without interpreting code or unsafe schemes", async () => {
  mount("[Media Studio](http://127.0.0.1:3000/graph-studio) and [Reference](https://example.test/docs?q=1&x=2).\n[Unsafe](javascript:alert(1)) [Data](data:text/html,hello) [Local](file:///private/test).\nInline `[Literal](https://example.test/literal)`.");
  const links = await screen.findAllByRole("link", {name: /Media Studio|Reference/});
  expect(links.map(link => link.getAttribute("href"))).toEqual(["http://127.0.0.1:3000/graph-studio", "https://example.test/docs?q=1&x=2"]);
  expect(links.every(link => link.getAttribute("target") === "_blank" && link.getAttribute("rel")?.includes("noopener") && link.getAttribute("rel")?.includes("noreferrer"))).toBe(true);
  expect(screen.queryByRole("link", {name: /Unsafe|Data|Local|Literal/})).toBeNull();
});

it("shows raw HTML as text and never creates actions from prose", async () => {
  const text = '<script>doNotExecute()</script> <img src=x onerror=doNotExecute()> <button>Run it</button>\nReview and run this graph.';
  mount(text);
  const messages = await screen.findByRole("region", {name: "Assistant messages"});
  const content = messages.querySelector(".graph-assistant-message-content")!;
  expect(content.textContent).toBe(text);
  expect(content.querySelector("script,img,button")).toBeNull();
  expect(screen.queryByRole("button", {name: "Review and run"})).toBeNull();
});

it("keeps a full long creative prompt and an unclosed literal fence without truncation or text interpretation", async () => {
  const prompt = "Keep camera action identity dialogue atmosphere and the exact geography. ".repeat(160) + "Exact ending: Now that’s a strong coffee.";
  const fence = "```text\n  **keep these stars**\n12. literal final line";
  mount("Shot 06: " + prompt + "\n\n" + fence);
  const messages = await screen.findByRole("region", {name: "Assistant messages"});
  expect(messages.querySelector("p")?.textContent).toBe("Shot 06: " + prompt);
  expect(messages.querySelector("pre")?.textContent).toBe(fence);
});

it("keeps image syntax and numeric labels that cannot be represented faithfully as native markers literal", async () => {
  mount("![Photo](https://example.test/photo.png)\n\n007. Preserve the padded label.\n99999999999999999999. Preserve every digit.");
  const messages = await screen.findByRole("region", {name: "Assistant messages"});
  expect(messages.textContent).toContain("![Photo](https://example.test/photo.png)");
  expect(messages.textContent).toContain("007. Preserve the padded label.");
  expect(messages.textContent).toContain("99999999999999999999. Preserve every digit.");
  expect(messages.querySelector(".graph-assistant-message-content a, .graph-assistant-message-content img, .graph-assistant-message-content li")).toBeNull();
});

it("retains balanced parentheses in an HTTP(S) destination and leaves more deeply nested destinations literal", async () => {
  const nested = "[Nested](https://example.test/a((b)))";
  mount("[Function](https://en.wikipedia.org/wiki/Function_(mathematics))\n" + nested);
  expect((await screen.findByRole("link", {name: "Function"})).getAttribute("href")).toBe("https://en.wikipedia.org/wiki/Function_(mathematics)");
  const messages = await screen.findByRole("region", {name: "Assistant messages"});
  expect(messages.textContent).toContain(nested);
  expect(screen.queryByRole("link", {name: "Nested"})).toBeNull();
});
