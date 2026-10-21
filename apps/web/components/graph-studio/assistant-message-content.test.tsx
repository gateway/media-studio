// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssistantMessageContent } from "./assistant-message-content";

afterEach(cleanup);

function message(text: string) {
  const { container } = render(<AssistantMessageContent text={text} />);
  return container.querySelector(".graph-assistant-message-content")!;
}

describe("authored assistant list markers", () => {
  it("keeps authored numbering through paragraph, unordered and ordered transitions", () => {
    const content = message("Before\ncontinuation\n- first\n* second\n7. seventh\n12) twelfth\nAfter");

    expect(Array.from(content.children, child => child.tagName)).toEqual(["P", "UL", "OL", "P"]);
    expect(content.children[0].textContent).toBe("Before\ncontinuation");
    expect(Array.from(content.querySelectorAll("ul li"), item => item.textContent)).toEqual(["first", "second"]);
    expect(Array.from(content.querySelectorAll("ol li"), item => [item.getAttribute("value"), item.textContent]))
      .toEqual([["7", "seventh"], ["12", "twelfth"]]);
    expect(content.children[3].textContent).toBe("After");
  });

  it.each(["0", "1", "2147483647"])("preserves native ordered value %s with both delimiters", number => {
    const content = message(`${number}. dot\n${number}) parenthesis`);

    expect(Array.from(content.querySelectorAll("ol li"), item => [item.getAttribute("value"), item.textContent]))
      .toEqual([[number, "dot"], [number, "parenthesis"]]);
  });

  it.each([
    "007. padded shot",
    "00) padded zero",
    "2147483648. outside native range",
    "99999999999999999999) preserve every digit",
    " 7. indented label",
    "  - nested-looking bullet",
    "-1. negative label",
    "+1. signed label",
    "1.",
    "Shot 03: keep the authored label",
  ])("keeps unsupported marker source literal: %s", text => {
    const content = message(text);

    expect(content.textContent).toBe(text);
    expect(content.querySelector("ul, ol, li")).toBeNull();
    expect(content.children[0].tagName).toBe("P");
  });

  it("flushes an unordered list at EOF without an extra paragraph", () => {
    const content = message("- one\n* two");

    expect(Array.from(content.children, child => child.tagName)).toEqual(["UL"]);
    expect(Array.from(content.querySelectorAll("li"), item => item.textContent)).toEqual(["one", "two"]);
  });

  it("keeps blank-line boundaries and trailing list-item whitespace", () => {
    const content = message("- first  \n\n7. second \n12) third  \n\nTail  ");

    expect(Array.from(content.children, child => child.tagName)).toEqual(["UL", "OL", "P"]);
    expect(Array.from(content.querySelectorAll("li"), item => item.textContent)).toEqual(["first  ", "second ", "third  "]);
    expect(content.children[2].textContent).toBe("Tail  ");
  });

  it("preserves CRLF source instead of normalizing it into recognized lists", () => {
    const text = "Intro  \r\n7. alpha \r\n12) beta\r\n\r\nTail  ";
    const content = message(text);

    expect(Array.from(content.children, child => child.tagName)).toEqual(["P", "P"]);
    expect(content.children[0].textContent).toBe("Intro  \r\n7. alpha \r\n12) beta\r");
    expect(content.children[1].textContent).toBe("Tail  ");
    expect(content.querySelector("li")).toBeNull();
  });

  it("keeps fenced marker-looking text literal between real lists", () => {
    const fence = "```text\n7. literal number\n- literal bullet\n```";
    const content = message(`- before\n\n${fence}\n12) after\nFinal paragraph`);

    expect(Array.from(content.children, child => child.tagName)).toEqual(["UL", "PRE", "OL", "P"]);
    expect(content.querySelector("pre")?.textContent).toBe(fence);
    expect(content.querySelectorAll("li")).toHaveLength(2);
    expect(content.querySelector("ol li")?.getAttribute("value")).toBe("12");
    expect(content.children[3].textContent).toBe("Final paragraph");
  });

  it("does not reinterpret markers in an unclosed literal fence at EOF", () => {
    const fence = "```text\n007. keep the digits\n- keep the bullet";
    const content = message(`7. before\n${fence}`);

    expect(Array.from(content.children, child => child.tagName)).toEqual(["OL", "PRE"]);
    expect(content.querySelector("pre")?.textContent).toBe(fence);
    expect(content.querySelectorAll("li")).toHaveLength(1);
    expect(content.querySelector("li")?.getAttribute("value")).toBe("7");
  });

  it.each(["", " ", "\n\t\n"])("retains the empty/blank fallback for %j", text => {
    const content = message(text);

    expect(Array.from(content.children, child => child.tagName)).toEqual(["P"]);
    expect(content.textContent).toBe(text);
  });
});
