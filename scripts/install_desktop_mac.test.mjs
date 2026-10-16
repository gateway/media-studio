import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installDesktopApp, launcherSource } from "./install_desktop_mac.mjs";

test("Finder launcher preserves quoted paths and does not evaluate shell metacharacters", { skip: process.platform !== "darwin" }, () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "studio-desktop-"));
  try {
    const root = path.join(temp, "Studio's \"test\" $HOME `false`");
    mkdirSync(root);
    const output = path.join(root, "arguments.json");
    const node = path.join(root, "fake node");
    writeFileSync(node, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2)));`, { mode: 0o755 });
    // Exercise AppleScript and shell quoting without opening a Terminal window.
    const source = launcherSource(root, node, "/usr/bin:/bin")
      .replace('tell application "Terminal"', "")
      .replace("    activate", "")
      .replace("do script", "do shell script")
      .replace("  end tell", "");
    const script = path.join(temp, "test.applescript");
    writeFileSync(script, source);
    const result = spawnSync("/usr/bin/osascript", [script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(output)), [path.join(root, "scripts/run_studio.mjs"), "--production", "--open"]);
    const destination = path.join(temp, "Desktop");
    const app = installDesktopApp(destination, { root, nodePath: node });
    assert.ok(existsSync(path.join(app, "Contents/Resources/applet.icns")));
    const signature = spawnSync("/usr/bin/codesign", ["--verify", "--strict", app], { encoding: "utf8" });
    assert.equal(signature.status, 0, signature.stderr);
    assert.equal(installDesktopApp(destination, { root, nodePath: node }), app);
    assert.throws(() => installDesktopApp(destination, { root: temp }), /Keeping the existing/);
    assert.equal(readFileSync(path.join(app, "Contents/Resources/media-studio-root.txt"), "utf8"), root);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
