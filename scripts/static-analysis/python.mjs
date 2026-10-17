import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const executable = process.env.STATIC_ANALYSIS_PYTHON || path.join(root, '.venv/static-analysis',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(executable)) {
  console.error('Python analysis environment missing. Follow scripts/static-analysis/README.md; lint never installs packages.');
  process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  const test = args[0] === '--test';
  const script = test ? 'test_gate.py' : 'gate.py';
  const result = spawnSync(executable, ['-B', path.join(root, 'scripts/static-analysis/python', script), ...args.slice(test ? 1 : 0)], {
    cwd: root, stdio: 'inherit', timeout: 300000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.error) console.error(result.error);
  process.exitCode = result.status ?? 1;
}
