import assert from "node:assert/strict";
import test from "node:test";

import {
  commandLooksLikeMediaStudio,
  parseWindowsProcessQueryResult,
  windowsListeningProcessQuery,
  windowsMediaStudioProcessQuery,
} from "./studio_process_identification.mjs";

test("matching requires an installation hint and a recognized command", () => {
  const root = "/workspace/custom-install";
  for (const suffix of ["scripts/run_studio.mjs", "scripts/dev_api.mjs", "uvicorn app.main:app", "next/dist/bin/next", "next start", "next dev"]) {
    assert.equal(commandLooksLikeMediaStudio(`${root} ${suffix}`, root), true, suffix);
    assert.equal(commandLooksLikeMediaStudio(`/other/media-studio ${suffix}`, root), true, suffix);
    assert.equal(commandLooksLikeMediaStudio(`/other/project ${suffix}`, root), false, suffix);
  }
  for (const command of ["", null, undefined, "node /workspace/custom-install/unrelated.mjs", "/other/media-studio node worker.mjs", "uvicorn other:app"]) {
    assert.equal(commandLooksLikeMediaStudio(command, root), false, String(command));
  }
});

test("matching normalizes Windows case and separators and preserves loose root matching", () => {
  assert.equal(commandLooksLikeMediaStudio('NODE "C:\\Users\\Me\\Custom App\\scripts\\dev_api.mjs"', "c:/users/me/custom app"), true);
  assert.equal(commandLooksLikeMediaStudio('NODE "C:\\Elsewhere\\MEDIA-STUDIO\\node_modules\\next\\dist\\bin\\next"', "C:\\Custom"), true);
  assert.equal(commandLooksLikeMediaStudio("/workspace/custom-install-backup next dev", "/workspace/custom-install"), true);
  assert.equal(commandLooksLikeMediaStudio("next dev", ""), true);
});

test("listening query preserves parseInt port semantics and complete PowerShell text", () => {
  const expected = `
$ErrorActionPreference = 'SilentlyContinue'
Get-NetTCPConnection -State Listen -LocalPort 3000 |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $_"
    if ($process) {
      [pscustomobject]@{ ProcessId = $process.ProcessId; CommandLine = $process.CommandLine }
    }
  } |
  ConvertTo-Json -Compress
`;
  for (const port of [3000, "3000", " 3000 ", "3000suffix", "3000; Stop-Process", "3000.9"]) {
    assert.equal(windowsListeningProcessQuery(port), expected);
  }
  for (const port of ["", "abc", null, undefined, NaN, Infinity]) {
    assert.equal(windowsListeningProcessQuery(port), null);
  }
  for (const port of [0, -1, 65536]) {
    assert.ok(windowsListeningProcessQuery(port).includes(`-LocalPort ${port} |`));
  }
});

test("root query preserves Windows paths and escapes PowerShell single quotes", () => {
  assert.equal(windowsMediaStudioProcessQuery("C:\\O'Brien\\Custom App"), `
$ErrorActionPreference = 'SilentlyContinue'
$root = 'C:\\O''Brien\\Custom App'
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) } |
  Select-Object ProcessId, CommandLine |
  ConvertTo-Json -Compress
`);
  assert.ok(windowsMediaStudioProcessQuery("").includes("$root = ''\n"));
});

test("query results keep single objects, arrays and valid JSON values unchanged", () => {
  const entry = { ProcessId: 42, CommandLine: "next dev" };
  for (const value of [entry, [entry], [], null, false, 42, "text"]) {
    const expected = Array.isArray(value) ? value : [value];
    assert.deepEqual(parseWindowsProcessQueryResult({ status: 0, stdout: JSON.stringify(value) }), expected);
  }
});

test("failed, blank and malformed query results produce no matches", () => {
  for (const result of [
    { status: 1, stdout: '{"ProcessId":42}' },
    { status: null, stdout: '{"ProcessId":42}' },
    { status: 0, stdout: "  \r\n" },
    { status: 0, stdout: "WARNING\n[]" },
    { status: 0, stdout: '[{"ProcessId":' },
  ]) {
    assert.deepEqual(parseWindowsProcessQueryResult(result), []);
  }
});
