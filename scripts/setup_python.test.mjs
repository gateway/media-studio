import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isolatedEnvironment, setupPython } from "./setup_python.mjs";

test("installer cannot inherit destinations from an activated/user Python", () => {
  const inherited = {
    PATH: "unchanged", VIRTUAL_ENV: "/user/venv", CONDA_PREFIX: "/user/conda",
    PYTHONHOME: "/user/python", PYTHONPATH: "/user/packages",
    PIP_TARGET: "/user/packages", PIP_PREFIX: "/user", PIP_USER: "1",
    PIP_CONFIG_FILE: "/user/pip.ini", UV_PYTHON: "3.14", UV_SYSTEM_PYTHON: "1",
    UV_PYTHON_INSTALL_DIR: "/user/python", UV_INSTALL_DIR: "/user/bin",
    PSModulePath: "/powershell-7/modules",
  };
  const env = isolatedEnvironment(path.resolve("private-runtime"), inherited);
  for (const name of ["VIRTUAL_ENV", "CONDA_PREFIX", "PYTHONHOME", "PYTHONPATH", "PIP_TARGET", "PIP_PREFIX", "PIP_USER", "UV_PYTHON", "UV_SYSTEM_PYTHON", "UV_INSTALL_DIR", "PSModulePath"]) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.PATH, inherited.PATH);
  assert.equal(inherited.UV_PYTHON, "3.14");
  assert.equal(env.UV_UNMANAGED_INSTALL, path.resolve("private-runtime", "bin"));
  assert.equal(env.UV_PYTHON_INSTALL_DIR, path.resolve("private-runtime", "python"));
  assert.equal(env.PIP_CONFIG_FILE, process.platform === "win32" ? "NUL" : "/dev/null");
});

test("an incomplete existing venv fails before download and preserves its contents", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "studio-runtime-test-"));
  const venv = path.join(root, ".venv");
  mkdirSync(venv);
  const marker = path.join(venv, "keep.txt");
  writeFileSync(marker, "existing installation");
  try {
    await assert.rejects(setupPython(root, root), /Preserved existing environment/);
    assert.equal(readFileSync(marker, "utf8"), "existing installation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
