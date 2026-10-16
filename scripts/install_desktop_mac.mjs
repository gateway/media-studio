#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const appleQuote = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`;

export function launcherSource(root, nodePath, searchPath) {
  // Finder does not load shell profiles. Capture the setup environment's tool paths.
  const command = `cd ${shellQuote(root)} && /usr/bin/env ${shellQuote(`PATH=${path.dirname(nodePath)}:${searchPath}`)} ${shellQuote(nodePath)} ${shellQuote(path.join(root, "scripts/run_studio.mjs"))} --production --open`;
  return `on run
  tell application "Terminal"
    activate
    do script ${appleQuote(command)}
  end tell
end run
`;
}

export function installDesktopApp(destination, { root = repoRoot, nodePath = process.execPath, searchPath = process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin" } = {}) {
  if (process.platform !== "darwin") throw new Error("The desktop app installer requires macOS.");
  mkdirSync(destination, { recursive: true });
  const target = path.join(destination, "Media Studio.app");
  const marker = path.join(target, "Contents/Resources/media-studio-root.txt");
  if (existsSync(target) && (!existsSync(marker) || readFileSync(marker, "utf8") !== root)) {
    throw new Error(`Keeping the existing ${target}; choose another destination or move it aside first.`);
  }
  const staging = mkdtempSync(path.join(destination, ".media-studio-app-"));
  try {
    const source = path.join(staging, "launcher.applescript");
    const app = path.join(staging, "Media Studio.app");
    writeFileSync(source, launcherSource(root, nodePath, searchPath));
    const result = spawnSync("/usr/bin/osacompile", ["-o", app, source], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "Unable to compile the desktop launcher.");
    copyFileSync(path.join(repoRoot, "scripts/assets/media-studio.icns"), path.join(app, "Contents/Resources/applet.icns"));
    writeFileSync(path.join(app, "Contents/Resources/media-studio-root.txt"), root);
    // osacompile signs its output; seal the resources again after adding our icon.
    const signing = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", app], { encoding: "utf8" });
    if (signing.status !== 0) throw new Error(signing.stderr || "Unable to sign the local desktop launcher.");
    // Only replace an app created for this same checkout, after compilation succeeds.
    if (existsSync(target)) rmSync(target, { recursive: true });
    renameSync(app, target);
    return target;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args[0]?.startsWith("--")) throw new Error("Usage: node scripts/install_desktop_mac.mjs [destination-folder]");
    const target = installDesktopApp(path.resolve(args[0] || path.join(os.homedir(), "Desktop")));
    console.log(`Desktop launcher installed: ${target}`);
    console.log("Double-click it to start Studio and open your browser. The Terminal window shows startup progress; Ctrl+C stops Studio.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
