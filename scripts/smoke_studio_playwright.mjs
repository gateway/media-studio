#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function resolveKieRoot() {
  const configured = process.env.MEDIA_STUDIO_KIE_API_REPO_PATH || process.env.KIE_ROOT;
  if (configured) {
    return path.resolve(configured);
  }
  const siblingKieApi = path.resolve(root, "..", "kie-api");
  const legacyKieBootstrap = path.resolve(root, "..", "kie-ai", "kie_codex_bootstrap");
  if (existsSync(siblingKieApi)) {
    return siblingKieApi;
  }
  if (existsSync(legacyKieBootstrap)) {
    return legacyKieBootstrap;
  }
  return siblingKieApi;
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

function startProcess(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  const append = (prefix, chunk) => {
    const text = chunk.toString();
    logs.push(`${prefix}${text}`);
    if (logs.length > 80) {
      logs.splice(0, logs.length - 80);
    }
  };
  child.stdout.on("data", (chunk) => append("", chunk));
  child.stderr.on("data", (chunk) => append("", chunk));
  return { child, logs };
}

function hasProductionWebBuild() {
  return existsSync(path.join(root, "apps", "web", ".next", "BUILD_ID"));
}

async function launchSmokeBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Executable doesn't exist") && !message.includes("playwright install")) {
      throw error;
    }
    return await chromium.launch({ channel: "chrome", headless: true });
  }
}

function stopProcess(proc) {
  if (!proc?.child || proc.child.killed) {
    return;
  }
  try {
    if (process.platform === "win32") {
      proc.child.kill();
    } else {
      process.kill(-proc.child.pid, "SIGTERM");
    }
  } catch {
    try {
      proc.child.kill("SIGTERM");
    } catch {
      // Best effort cleanup.
    }
  }
}

async function waitForUrl(url, { timeoutMs = 60_000, headers = {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw lastError ?? new Error(`${url} did not become ready`);
}

function printLogs(name, proc) {
  if (!proc?.logs?.length) {
    return;
  }
  console.error(`\n--- ${name} recent logs ---`);
  console.error(proc.logs.join("").trim());
}

async function writeFailureArtifacts({ page, consoleErrors, apiProc, webProc, error, apiBaseUrl, webBaseUrl }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactRoot = process.env.MEDIA_STUDIO_SMOKE_ARTIFACT_DIR
    ? path.resolve(process.env.MEDIA_STUDIO_SMOKE_ARTIFACT_DIR)
    : path.join(root, "test-results", "media-studio-smoke");
  const artifactDir = path.join(artifactRoot, stamp);
  await fs.mkdir(artifactDir, { recursive: true });

  const metadata = {
    created_at: new Date().toISOString(),
    api_base_url: apiBaseUrl,
    web_base_url: webBaseUrl,
    current_url: page?.url?.() ?? null,
    error: {
      name: error?.name ?? "Error",
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    },
  };

  await fs.writeFile(path.join(artifactDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  await fs.writeFile(path.join(artifactDir, "console-errors.json"), `${JSON.stringify(consoleErrors ?? [], null, 2)}\n`);
  await fs.writeFile(path.join(artifactDir, "api.log"), (apiProc?.logs ?? []).join(""));
  await fs.writeFile(path.join(artifactDir, "web.log"), (webProc?.logs ?? []).join(""));

  if (page && !page.isClosed()) {
    try {
      await page.screenshot({ path: path.join(artifactDir, "failure.png"), fullPage: true });
    } catch (screenshotError) {
      await fs.writeFile(path.join(artifactDir, "screenshot-error.txt"), String(screenshotError));
    }
    try {
      await fs.writeFile(path.join(artifactDir, "failure.html"), await page.content());
    } catch (htmlError) {
      await fs.writeFile(path.join(artifactDir, "html-error.txt"), String(htmlError));
    }
  }

  console.error(`\nSmoke failure artifacts written to ${artifactDir}`);
}

async function assertNoLoadError(page, routePath) {
  const loadError = page.getByText("This page could not load", { exact: true });
  if ((await loadError.count()) > 0) {
    throw new Error(`${routePath} rendered the app-level load error.`);
  }
}

async function smokeAdminRoute(page, webBaseUrl, { path: routePath, heading, text }) {
  await page.goto(`${webBaseUrl}${routePath}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: heading }).first().waitFor({ timeout: 45_000 });
  if (text) {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15_000 });
  }
  await assertNoLoadError(page, routePath);
}

async function run() {
  const kieRoot = resolveKieRoot();
  const pythonPath = path.join(kieRoot, ".venv", "bin", "python");
  if (!existsSync(pythonPath)) {
    throw new Error(`KIE Python runtime not found at ${pythonPath}. Run setup or set MEDIA_STUDIO_KIE_API_REPO_PATH.`);
  }
  const apiPort = await freePort();
  const webPort = await freePort();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "media-studio-smoke-"));
  const dataRoot = path.join(tempRoot, "data");
  const dbPath = path.join(tempRoot, "media-studio.db");
  const token = "studio-smoke-control-token";
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const webBaseUrl = `http://127.0.0.1:${webPort}`;
  let apiProc = null;
  let webProc = null;
  let browser = null;
  let page = null;
  const consoleErrors = [];

  try {
    apiProc = startProcess(pythonPath, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(apiPort)], {
      cwd: path.join(root, "apps", "api"),
      env: {
        ...process.env,
        MEDIA_STUDIO_APP_ENV: "test",
        MEDIA_STUDIO_API_HOST: "127.0.0.1",
        MEDIA_STUDIO_API_PORT: String(apiPort),
        MEDIA_STUDIO_DB_PATH: dbPath,
        MEDIA_STUDIO_DATA_ROOT: dataRoot,
        MEDIA_STUDIO_KIE_API_REPO_PATH: kieRoot,
        MEDIA_ENABLE_LIVE_SUBMIT: "false",
        MEDIA_BACKGROUND_POLL_ENABLED: "true",
        MEDIA_POLL_SECONDS: "1",
        MEDIA_PRICING_REFRESH_ON_STARTUP: "false",
        MEDIA_STUDIO_CONTROL_API_TOKEN: token,
        KIE_API_KEY: "",
        OPENROUTER_API_KEY: "",
      },
    });
    await waitForUrl(`${apiBaseUrl}/health`, { timeoutMs: 60_000 });

    const webMode = hasProductionWebBuild() ? "start" : "dev";
    webProc = startProcess("npm", ["--workspace", "apps/web", "run", webMode, "--", "--hostname", "127.0.0.1", "--port", String(webPort)], {
      cwd: root,
      env: {
        ...process.env,
        MEDIA_STUDIO_APP_ENV: "test",
        MEDIA_STUDIO_CONTROL_API_BASE_URL: apiBaseUrl,
        NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL: apiBaseUrl,
        MEDIA_STUDIO_CONTROL_API_TOKEN: token,
        MEDIA_STUDIO_ALLOW_PRIVATE_NETWORK_ACCESS: "false",
      },
    });
    await waitForUrl(`${webBaseUrl}/studio`, { timeoutMs: 90_000 });

    browser = await launchSmokeBrowser();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const adminRoutes = [
      { path: "/settings", heading: "Settings", text: "Queue Settings" },
      { path: "/settings/llms", heading: "AI Settings", text: "Prompt Enhance default model" },
      { path: "/setup", heading: "Connect Services", text: "Connect KIE" },
      { path: "/models", heading: "Models", text: "Model Setup" },
      { path: "/presets", heading: "Presets", text: "Media Presets" },
      { path: "/jobs", heading: "Jobs", text: "Recent Jobs" },
      { path: "/pricing", heading: "Pricing", text: "Live pricing context" },
    ];
    for (const route of adminRoutes) {
      await smokeAdminRoute(page, webBaseUrl, route);
    }

    await page.goto(`${webBaseUrl}/studio`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("studio-gallery").waitFor({ timeout: 45_000 });
    const libraryButton = page.getByTestId("studio-filter-library");
    await libraryButton.waitFor({ timeout: 10_000 });
    await libraryButton.click();
    await page.getByTestId("studio-reference-library").waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "Close reference library" }).click();
    await page.getByTestId("studio-picker-model").click();
    await page.getByText("Images", { exact: true }).first().waitFor({ timeout: 10_000 });
    await page.getByText("Video", { exact: true }).first().waitFor({ timeout: 10_000 });

    const generateButton = page.getByTestId("studio-generate-button");
    await page.getByTestId("studio-picker-option-model-gpt-image-2-image-to-image").click();
    await page.getByTestId("studio-prompt-input").fill("Turn the reference into a cinematic neon portrait.");
    await page.waitForTimeout(500);
    if (!(await generateButton.isDisabled())) {
      await generateButton.click();
      await page.waitForTimeout(1000);
      const cardCount = await page.locator('[data-testid="studio-gallery-card"], [data-testid="studio-gallery-batch-card"]').count();
      if (cardCount !== 0) {
        throw new Error("GPT Image 2 image-to-image created a gallery job without a required image.");
      }
    }

    await page.getByTestId("studio-picker-model").click();
    await page.getByTestId("studio-picker-option-model-gpt-image-2-text-to-image").click();

    await page.getByTestId("studio-prompt-input").fill(
      "A cinematic realistic sci-fi botanical lab at sunrise, glass walls, clean composition, detailed reflections.",
    );
    await generateButton.waitFor({ timeout: 10_000 });
    if (await generateButton.isDisabled()) {
      throw new Error("Generate button stayed disabled for GPT Image 2 text-to-image.");
    }
    await generateButton.click();
    await page.locator('[data-testid="studio-gallery-card"], [data-testid="studio-gallery-batch-card"]').first().waitFor({ timeout: 45_000 });

    await page.goto(`${webBaseUrl}/graph-studio`, { waitUntil: "domcontentloaded" });
    const graphCanvas = page.getByTestId("graph-canvas");
    await graphCanvas.waitFor({ timeout: 45_000 });
    await page.getByTestId("graph-run-button").waitFor({ timeout: 15_000 });
    await page.getByTestId("graph-workflow-tabs").click();
    await page.getByTestId("graph-workflow-menu").waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.getByTestId("graph-workflow-menu").waitFor({ state: "hidden", timeout: 10_000 });
    const graphConsole = page.getByTestId("graph-console");
    const graphConsoleButton = page.getByTestId("graph-sidebar-console-button");
    await graphConsoleButton.waitFor({ timeout: 15_000 });
    if ((await graphConsole.count()) > 0 && (await graphConsole.isVisible())) {
      await graphConsoleButton.click();
      await graphConsole.waitFor({ state: "hidden", timeout: 10_000 });
    }
    await graphConsoleButton.click();
    await graphConsole.waitFor({ timeout: 10_000 });
    await graphConsoleButton.click();
    await graphConsole.waitFor({ state: "hidden", timeout: 10_000 });
    await graphConsoleButton.click();
    await graphConsole.waitFor({ timeout: 10_000 });
    await page.getByTestId("graph-sidebar-workflows-button").waitFor({ timeout: 15_000 });
    await page.getByTestId("graph-sidebar-nodes-button").waitFor({ timeout: 15_000 });
    await page.getByTestId("graph-sidebar-images-button").waitFor({ timeout: 15_000 });
    const initialGraphNodes = await page.locator('[data-testid^="graph-node-"]').count();
    if (initialGraphNodes !== 0) {
      throw new Error(`Graph Studio should start blank, found ${initialGraphNodes} starter nodes.`);
    }
    await page.getByTestId("graph-sidebar-workflows-button").click();
    await page.getByTestId("graph-workflows-modal").waitFor({ timeout: 10_000 });
    await page.getByTestId("graph-template-nano-image-pipeline").click();
    await page.getByTestId("graph-workflows-modal").waitFor({ state: "hidden", timeout: 10_000 });
    await page.getByTestId("graph-sidebar-nodes-button").click();
    await page.getByTestId("graph-nodes-modal").waitFor({ timeout: 10_000 });
    await page.getByText("Load Image", { exact: true }).first().waitFor({ timeout: 10_000 });
    await page.getByText("Save Image", { exact: true }).first().waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.getByTestId("graph-nodes-modal").waitFor({ state: "hidden", timeout: 10_000 });
    await page.getByTestId("graph-sidebar-images-button").click();
    await page.getByRole("dialog", { name: "Image Assets" }).waitFor({ timeout: 10_000 });
    await page.getByRole("tab", { name: "Generated" }).waitFor({ timeout: 10_000 });
    await page.getByRole("tab", { name: "Imported" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Image Assets" }).waitFor({ state: "hidden", timeout: 10_000 });
    await page.getByTestId("graph-node-prompt.text").waitFor({ timeout: 15_000 });
    await page.getByTestId("graph-node-media.load_image").waitFor({ timeout: 15_000 });
    const graphModelNode = page.getByTestId("graph-node-model.kie.nano_banana_pro");
    await graphModelNode.waitFor({ timeout: 15_000 });
    const modelPrompt = graphModelNode.getByPlaceholder("Describe the image to generate or edit...");
    if (!(await modelPrompt.isDisabled())) {
      throw new Error("Connected model prompt field was not disabled.");
    }
    await page
      .locator('[data-testid^="graph-node-preview-media.load_image"] button[aria-label="Choose media from library"]')
      .click();
    await page.getByRole("dialog", { name: "Image Assets" }).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Image Assets" }).waitFor({ state: "hidden", timeout: 10_000 });
    await page.getByText("Load Image", { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.getByText("Save Image", { exact: true }).first().waitFor({ timeout: 15_000 });
    if (consoleErrors.length) {
      throw new Error(`Console errors during Studio smoke:\n${consoleErrors.join("\n")}`);
    }
    console.log("Studio browser smoke passed.");
  } catch (error) {
    await writeFailureArtifacts({ page, consoleErrors, apiProc, webProc, error, apiBaseUrl, webBaseUrl });
    printLogs("api", apiProc);
    printLogs("web", webProc);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    stopProcess(webProc);
    stopProcess(apiProc);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
