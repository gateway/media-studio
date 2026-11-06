import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const preload = fileURLToPath(new URL("./dev-stdio.cjs", import.meta.url));

function runChild(source, disconnectOutput = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--require", preload, "-e", source], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let result;
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (data) => { stderr += data; });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Child event loop stalled after log readers disconnected"));
    }, 5000);
    child.on("message", (message) => {
      if (message === "ready") {
        if (disconnectOutput) {
          child.stdout.destroy();
          child.stderr.destroy();
        }
        child.send("run");
      } else {
        result = message;
      }
    });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, result, stderr });
    });
  });
}

test("disconnected output cannot feed Next exception logging back into itself", async () => {
  const { code, result } = await runChild(`
    require('next/dist/server/node-environment');
    const log = require('next/dist/build/output/log');
    // Next registers multiple exception reporters in the dev server process.
    for (let i = 0; i < 3; i++) process.on('uncaughtException', error => log.error(error));
    let exceptions = 0;
    process.on('uncaughtExceptionMonitor', () => exceptions++);
    process.on('message', () => {
      const start = process.cpuUsage();
      process.stdout.write('request log\\n');
      process.stderr.write('error log\\n');
      setTimeout(() => {
        const cpu = process.cpuUsage(start);
        process.send({ exceptions, cpuMicros: cpu.user + cpu.system }, () => process.exit(0));
      }, 300);
    });
    process.send('ready');
  `, true);
  assert.equal(code, 0);
  assert.equal(result.exceptions, 0, "EPIPE escaped into recursive exception reporters");
  assert.ok(result.cpuMicros < 150000, `Idle child consumed ${result.cpuMicros} µs CPU in 300 ms`);
});

test("output errors other than EPIPE remain failures", async () => {
  const { code, stderr } = await runChild(`
    process.stderr.emit('error', Object.assign(new Error('stdio failure'), { code: 'EIO' }));
  `);
  assert.notEqual(code, 0);
  assert.match(stderr, /stdio failure/);
});

test("Next forwards the preload to its dev server child", async () => {
  const { code, result } = await runChild(`
    const { getParsedNodeOptions, formatNodeOptions } = require('next/dist/server/lib/utils');
    const { spawnSync } = require('node:child_process');
    // The real Next CLI has no -e argument; remove this test harness argument.
    process.execArgv = process.execArgv.slice(0, process.execArgv.indexOf("-e"));
    const options = formatNodeOptions(getParsedNodeOptions());
    const child = spawnSync(process.execPath, [...options.execArgv, '-e',
      'process.stdout.write(String(process.stderr.listeners("error").some(fn => fn.name === "handleDevStdioError")))'
    ], { env: { ...process.env, NODE_OPTIONS: options.nodeOptions }, encoding: 'utf8' });
    process.send({ status: child.status, stdout: child.stdout });
    process.disconnect();
  `);
  assert.equal(code, 0);
  assert.deepEqual(result, { status: 0, stdout: "true" });
});
