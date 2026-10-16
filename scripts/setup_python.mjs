import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { venvPythonPath } from "./media_runtime.mjs";

const uvVersion = "0.13.1";
const pythonVersion = "3.11";

// Activated environments and user installer settings must not redirect writes.
export function isolatedEnvironment(runtimeRoot, inherited = process.env) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) =>
    !/^(UV_|PIP_|PYTHON|VIRTUAL_ENV$|CONDA_PREFIX$)/i.test(key)));
  return {
    ...env,
    UV_UNMANAGED_INSTALL: path.join(runtimeRoot, "bin"),
    UV_NO_MODIFY_PATH: "1",
    UV_PYTHON_INSTALL_DIR: path.join(runtimeRoot, "python"),
    UV_PYTHON_BIN_DIR: path.join(runtimeRoot, "bin"),
    UV_CACHE_DIR: path.join(runtimeRoot, "cache"),
    PIP_CONFIG_FILE: process.platform === "win32" ? "NUL" : "/dev/null",
    PIP_CACHE_DIR: path.join(runtimeRoot, "cache", "pip"),
    PYTHONNOUSERSITE: "1",
  };
}

function run(command, args, env, capture = false) {
  const result = spawnSync(command, args, {
    env, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(command)} failed (${result.status ?? result.error?.message}). ${capture ? result.stderr : "See output above."}`);
  }
  return result.stdout?.trim();
}

function within(parent, child) {
  const relative = path.relative(realpathSync(parent), realpathSync(child));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export function verifyEnvironment(kieRoot, env) {
  const venv = path.join(kieRoot, ".venv");
  const python = venvPythonPath(kieRoot);
  const managedRoot = path.join(kieRoot, ".media-studio-runtime", "python");
  const info = JSON.parse(run(python, ["-I", "-c",
    "import json,sys; print(json.dumps({'version': list(sys.version_info[:2]), 'prefix': sys.prefix, 'base': sys.base_prefix}))",
  ], env, true));
  if (lstatSync(venv).isSymbolicLink() || info.version.join(".") !== pythonVersion ||
      realpathSync(info.prefix) !== realpathSync(venv) || !existsSync(managedRoot) || !within(managedRoot, info.base)) {
    throw new Error("The existing environment is not an isolated Media Studio Python 3.11 environment.");
  }
  return python;
}

export async function setupPython(mediaRoot, kieRoot) {
  const runtimeRoot = path.join(kieRoot, ".media-studio-runtime");
  const env = isolatedEnvironment(runtimeRoot);
  env.MEDIA_STUDIO_KIE_API_REPO_PATH = kieRoot;
  const venv = path.join(kieRoot, ".venv");
  const hadEnvironment = existsSync(venv);
  if (hadEnvironment) {
    try {
      verifyEnvironment(kieRoot, env);
    } catch (error) {
      throw new Error(`${error.message}\nPreserved existing environment: ${venv}\nStop Studio, move that .venv folder to a backup location, then rerun onboarding. Do not move or delete your .env, database, or media folders.`);
    }
  }

  const uv = path.join(runtimeRoot, "bin", process.platform === "win32" ? "uv.exe" : "uv");
  if (!existsSync(uv)) {
    mkdirSync(runtimeRoot, { recursive: true });
    const extension = process.platform === "win32" ? "ps1" : "sh";
    const response = await fetch(`https://astral.sh/uv/${uvVersion}/install.${extension}`, {
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Unable to download uv installer: HTTP ${response.status}`);
    const installer = path.join(runtimeRoot, `install-uv.${extension}`);
    writeFileSync(installer, await response.text());
    if (process.platform === "win32") {
      run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installer], env);
    } else {
      run("sh", [installer], env);
    }
  }

  if (!hadEnvironment) {
    run(uv, ["--no-config", "python", "install", pythonVersion, "--no-bin"], env);
    run(uv, ["--no-config", "venv", "--managed-python", "--python", pythonVersion, venv], env);
  }
  const python = verifyEnvironment(kieRoot, env);
  console.log(`Shared Python ${pythonVersion}: ${python}`);
  // uv can seed pip again after an interrupted installation left it missing.
  run(uv, ["--no-config", "pip", "install", "--python", python, "--upgrade", "pip", "setuptools", "wheel"], env);
  run(python, ["-I", "-m", "pip", "install", "-e", kieRoot, "-e", path.join(mediaRoot, "apps", "api")], env);
  run(python, ["-I", "-m", "pip", "check"], env);
  run(python, ["-I", path.join(mediaRoot, "scripts", "verify_shared_python.py")], env);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mediaRoot, kieRoot] = process.argv.slice(2);
  if (!mediaRoot || !kieRoot) {
    console.error("Usage: node scripts/setup_python.mjs MEDIA_ROOT KIE_ROOT");
    process.exitCode = 1;
  } else {
    setupPython(path.resolve(mediaRoot), path.resolve(kieRoot)).catch((error) => {
      console.error(`Python setup failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
