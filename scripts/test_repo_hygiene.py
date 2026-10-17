"""Pure publication-policy tests; no application imports or runtime fixtures."""
from __future__ import annotations

import contextlib
import importlib.util
import io
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("repo_hygiene", ROOT / "scripts/check_repo_hygiene.py")
hygiene = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hygiene)

PRIVATE_PATHS = (
    "docs/design-admin.md", ".agents/skills/media-studio-admin-ui/SKILL.md",
    ".agents/skills/media-studio-admin-ui/agents/openai.yaml", "design/admin-theme/screenshot.png",
    "AGENTS.md", "docs/agents/operator.md", "docs/engineering/review.md",
    ".scratch/evidence.json", "docs/development/plan.md", "docs/reviews/report.md",
    ".env", ".env.local", "data/reference-media/private.txt", "outputs/result.txt",
    "private.key", "apps/web/.env.production", "apps/api/AGENTS.md",
)
PUBLIC_PATHS = (
    ".env.example", "apps/web/.env.example", "README.md", "docs/getting-started-windows.md",
    "scripts/onboard_windows.ps1", "content/graph-workflows/example.json",
    "scripts/check_admin_theme.mjs", "scripts/admin-theme-exceptions.json",
)


class RepoHygieneTests(unittest.TestCase):
    def test_private_files_cannot_pass_hygiene(self):
        for name in PRIVATE_PATHS:
            with self.subTest(path=name):
                self.assertTrue(hygiene.is_blocked(name))

    def test_public_source_and_examples_remain_allowed(self):
        for name in PUBLIC_PATHS:
            with self.subTest(path=name):
                self.assertFalse(hygiene.is_blocked(name))

    def test_forced_staging_fails_the_hygiene_gate(self):
        with patch.object(hygiene.subprocess, "check_output", return_value="README.md\n.scratch/evidence.json\n"):
            with contextlib.redirect_stderr(io.StringIO()) as error:
                self.assertEqual(hygiene.main(), 1)
        self.assertIn(".scratch/evidence.json", error.getvalue())

    def test_git_ignores_and_exports_exclude_private_files(self):
        # This is a disposable Git fixture with synthetic text, not a Studio instance.
        with tempfile.TemporaryDirectory(prefix="publication-policy-") as folder:
            repo = Path(folder)
            for name in (".gitignore", ".gitattributes"):
                shutil.copyfile(ROOT / name, repo / name)
            for name in PRIVATE_PATHS + PUBLIC_PATHS:
                path = repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("synthetic publication-policy fixture\n")

            def git(*args):
                return subprocess.check_output(["git", "-C", str(repo), *args], stderr=subprocess.PIPE)

            git("init", "--quiet")
            for name in PRIVATE_PATHS:
                with self.subTest(ignored=name):
                    self.assertEqual(git("check-ignore", name).decode().strip(), name)
            for name in PUBLIC_PATHS:
                result = subprocess.run(["git", "-C", str(repo), "check-ignore", "--quiet", name])
                self.assertEqual(result.returncode, 1, name)
            # Even an accidental force-add must not place private files in exports.
            git("add", "--force", ".")
            tree = git("write-tree").decode().strip()
            with tarfile.open(fileobj=io.BytesIO(git("archive", tree)), mode="r:") as archive:
                names = archive.getnames()
            for name in PRIVATE_PATHS:
                self.assertNotIn(name, names)
            for name in PUBLIC_PATHS:
                self.assertIn(name, names)


if __name__ == "__main__":
    unittest.main()
