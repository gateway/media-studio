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

    webProc = startProcess("npm", ["--workspace", "apps/web", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(webPort)], {
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

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    await page.goto(`${webBaseUrl}/studio`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("studio-gallery").waitFor({ timeout: 45_000 });
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

    if (consoleErrors.length) {
      throw new Error(`Console errors during Studio smoke:\n${consoleErrors.join("\n")}`);
    }
    console.log("Studio browser smoke passed.");
  } catch (error) {
    printLogs("api", apiProc);
    printLogs("web", webProc);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    stopProcess(webProc);
    stopProcess(apiProc);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
