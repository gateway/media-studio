import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const css = await readFile(new URL("../apps/web/app/graph-studio/styles/nodes/media-display.css", import.meta.url), "utf8");
const samples = [
  "https://example.test/" + "UnbrokenOutputToken".repeat(20),
  JSON.stringify({ prompt: "Long generated description ".repeat(20), enabled: true }, null, 2),
  "First line\n  Indented line\n\nLast line with preserved spacing.",
  "ภาษาไทย 日本語 한글 👩🏽‍💻 ".repeat(25),
];

test("Graph output keeps legacy wrapping, whitespace and scrolling at narrow/wide sizes", { timeout: 60_000 }, async (t) => {
  // CI uses its installed Chromium; local checks can use an existing Chrome.
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  t.after(() => browser.close());
  for (const width of [375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route("**/*", (route) => route.abort());
    for (const mode of ["text-only", "has-media"]) {
      for (const inherited of ["normal", "break-all", "keep-all"]) {
        await page.setContent(`<style>${css}
          body { margin: 0; font: 16px monospace; word-break: ${inherited}; }
          .graph-display-any { width: ${Math.min(width - 32, 640)}px; height: 300px; }
        </style><div class="graph-display-any graph-display-any-${mode}">
          <div class="graph-display-any-text-wrap"><div class="graph-display-any-text-meta">Output</div>
            <button class="graph-display-any-copy" aria-label="Copy output">Copy</button>
            <pre class="graph-display-any-text nodrag nopan"></pre>
          </div></div>`);
        for (const sample of samples) {
          await page.locator("pre").evaluate((element, value) => { element.textContent = value; }, sample);
          await page.evaluate(() => document.fonts.ready);
          const current = await geometry(page);
          const currentPixels = await page.screenshot();
          await page.locator("pre").evaluate((element) => {
            element.style.wordBreak = "break-word";
            element.style.overflowWrap = "normal";
          });
          assert.deepEqual(await geometry(page), current, `${width}/${mode}/${inherited}: line breaks and scroll bounds`);
          assert.ok((await page.screenshot()).equals(currentPixels), `${width}/${mode}/${inherited}: rendered pixels`);
          assert.equal(current.text, sample);
          assert.ok(current.scrollWidth <= current.clientWidth + 1, "Long output must wrap without horizontal overflow");
          await page.locator("pre").evaluate((element) => { element.removeAttribute("style"); });
        }
      }
    }
    await page.close();
  }
});

async function geometry(page) {
  return page.locator("pre").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      text: element.textContent,
      clientWidth: element.clientWidth, clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
      lines: Array.from(range.getClientRects(), ({ x, y, width, height }) => ({ x, y, width, height })),
    };
  });
}
