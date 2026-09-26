#!/usr/bin/env node
// Uses an already-running populated installation. Never starts services or creates data.
// Run: npm run smoke:assistant-layout -- <existing-workflow-id>
// The workflow must have nodes and an existing graph_workflow-owned conversation.
// MEDIA_STUDIO_LAYOUT_URL defaults to http://127.0.0.1:3000.
// MEDIA_STUDIO_LAYOUT_BROWSER defaults to installed Chrome (no browser download).
// Verify the target installation per docs/agents/runtime-verification.md first.
// This is layout coverage; estimates are blocked and no generation is exercised.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const baseURL = process.env.MEDIA_STUDIO_LAYOUT_URL || 'http://127.0.0.1:3000';
const workflowId = process.argv[2];
assert(workflowId, 'Usage: npm run smoke:assistant-layout -- <existing-workflow-id>');
async function read(path) {
  const response = await fetch(new URL(path, baseURL));
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
const health = await read('/api/control/health');
assert(health.install_id, 'The running installation must identify itself.');
const workflow = await read(`/api/control/media/graph/workflows/${encodeURIComponent(workflowId)}`);
assert(workflow.workflow_json?.nodes?.length, 'Choose an existing populated workflow.');
const sessions = await read(`/api/control/media/assistant/sessions?owner_kind=graph_workflow&owner_id=${encodeURIComponent(workflowId)}&limit=1`);
const session = sessions.items?.[0];
assert(session?.messages?.length, 'Choose a workflow with an existing assistant conversation.');
const browser = await chromium.launch({ headless: true, channel: process.env.MEDIA_STUDIO_LAYOUT_BROWSER || 'chrome' });
try {
  // A fresh browser context leaves the user's tabs, draft, and layout preferences alone.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const blocked = new Set();
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.add(new URL(request.url()).pathname);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await context.addInitScript(({ health, workflow, session }) => {
    const tab = {
      tab_id: 'layout-regression', workflow_id: workflow.workflow_id,
      workflow_name: workflow.name, workflow_json: workflow.workflow_json,
      assistant_session_id: session.assistant_session_id,
      run_id: null, run_status: null, dirty: false, updated_at: workflow.updated_at,
    };
    localStorage.setItem(`media-studio:graph-studio:tabs:${health.install_id}`,
      JSON.stringify({ schema_version: 5, active_tab_id: tab.tab_id, tabs: [tab] }));
  }, { health, workflow, session });
  const page = await context.newPage();
  await page.goto(new URL('/graph-studio', baseURL).href);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button', { name: 'Show Media Assistant', exact: true }).click();
  const panel = page.locator('.graph-assistant-panel');
  const prompt = page.getByRole('textbox', { name: 'Assistant message', exact: true });
  await expect(prompt).toBeVisible();
  await expect(page.locator('.graph-assistant-message').first()).toBeVisible();
  const draft = 'Layout regression draft — do not send';
  await prompt.fill(draft);

  async function checkLayout(placement) {
    await expect(panel).toHaveAttribute('data-placement', placement);
    await expect.poll(async () => page.evaluate((placement) => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const panel = rect('.graph-assistant-panel');
      const toolbar = rect('.graph-toolbar');
      const prompt = rect('[aria-label="Assistant message"]');
      const send = rect('[aria-label="Send chat message"]');
      const canvas = rect('.react-flow');
      const inside = (r) => r.top >= panel.top - 1 && r.bottom <= panel.bottom + 1 && r.left >= panel.left - 1 && r.right <= panel.right + 1;
      return panel.top >= -1 && panel.bottom <= innerHeight + 1 &&
        panel.left >= -1 && panel.right <= innerWidth + 1 && inside(prompt) && inside(send) &&
        (placement !== 'right' || (Math.abs(panel.top - toolbar.bottom) <= 1 && Math.abs(panel.bottom - innerHeight) <= 1 && canvas.right <= panel.left + 1 && canvas.width >= 479));
    }, placement), { message: `${placement}: panel and composer fit; dock starts below toolbar` }).toBe(true);
    await expect(prompt).toHaveValue(draft);
  }
  await checkLayout('right');
  const divider = page.getByRole('separator', { name: 'Resize Media Assistant' });
  const initialWidth = (await panel.boundingBox()).width;
  await divider.press('ArrowLeft');
  await expect.poll(async () => (await panel.boundingBox()).width).toBeGreaterThan(initialWidth);
  await checkLayout('right');
  await page.getByRole('button', { name: 'Float Media Assistant', exact: true }).click();
  await checkLayout('floating');
  await page.getByRole('button', { name: 'Dock Media Assistant on right', exact: true }).click();
  await checkLayout('right');
  const grip = page.getByRole('button', { name: 'Resize prompt height', exact: true });
  const promptHeight = (await prompt.boundingBox()).height;
  const gripBox = await grip.boundingBox();
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y - 80, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await prompt.boundingBox()).height).toBeGreaterThan(promptHeight);
  await checkLayout('right');
  await page.getByRole('button', { name: 'Show console', exact: true }).click();
  const consolePanel = page.getByTestId('graph-console');
  const initialConsoleHeight = (await consolePanel.boundingBox()).height;
  const consoleGrip = await page.getByTestId('graph-console-resizer').boundingBox();
  await page.mouse.move(consoleGrip.x + consoleGrip.width / 2, consoleGrip.y + 2);
  await page.mouse.down();
  await page.mouse.move(consoleGrip.x + consoleGrip.width / 2, 100, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await consolePanel.boundingBox()).height).toBeGreaterThan(initialConsoleHeight);
  await page.setViewportSize({ width: 1440, height: 500 });
  await checkLayout('right');
  await expect.poll(async () => (await consolePanel.boundingBox()).height).toBeLessThanOrEqual(201);
  await expect(consolePanel).toBeVisible();
  await expect.poll(async () => consolePanel.evaluate((element) => {
    const console = element.getBoundingClientRect();
    const panel = document.querySelector('.graph-assistant-panel').getBoundingClientRect();
    return console.height > 0 && console.top >= 0 && Math.abs(console.bottom - innerHeight) <= 1 && console.right <= panel.left + 1;
  })).toBe(true);
  await page.setViewportSize({ width: 800, height: 500 });
  await checkLayout('floating');
  await page.setViewportSize({ width: 1440, height: 900 });
  await checkLayout('right');
  await page.getByRole('button', { name: 'Close Media Assistant', exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Show Media Assistant', exact: true }).click();
  await checkLayout('right');
  // The automatic price estimate is intentionally blocked along with all writes.
  assert.deepEqual([...blocked].filter((path) => path !== '/api/control/media/graph/estimate'), [], 'Unexpected mutation attempted');
  console.log(`PASS assistant layout: install ${health.install_id}; workflow ${workflowId}; dock/float, resize, short viewport, console, draft preservation. No writes sent.`);
} finally {
  await browser.close();
}
