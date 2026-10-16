import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("reopening a live install uses its recorded ports without starting another runtime", async () => {
  const data = mkdtempSync(path.join(os.tmpdir(), "studio-reopen-"));
  const server = createServer((req, res) => {
    if (req.url === "/health") res.end(JSON.stringify({ install_id: "desktop-test" }));
    else if (req.url === "/icon.svg") res.end("icon");
    else { res.statusCode = 404; res.end(); }
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    mkdirSync(path.join(data, "runtime"));
    writeFileSync(path.join(data, "runtime/media-studio-session.json"), JSON.stringify({
      pid: process.pid, installId: "desktop-test", apiHost: "127.0.0.1", webHost: "127.0.0.1", apiPort: port, webPort: port,
    }));
    const child = spawn(process.execPath, [new URL("./run_studio.mjs", import.meta.url).pathname, "--production", "--no-open"], {
      env: { ...process.env, MEDIA_STUDIO_DATA_ROOT: data, MEDIA_STUDIO_INSTALL_ID: "desktop-test",
        MEDIA_STUDIO_API_HOST: "127.0.0.1", MEDIA_STUDIO_WEB_HOST: "127.0.0.1",
        MEDIA_STUDIO_API_PORT: "18089", MEDIA_STUDIO_WEB_PORT: "13009" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const exit = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    assert.equal(exit, 0, output);
    assert.match(output, new RegExp(`already running: http://127.0.0.1:${port}/studio`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(data, { recursive: true, force: true });
  }
});
