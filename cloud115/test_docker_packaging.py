import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest


class DockerPackagingTests(unittest.TestCase):
    def test_runtime_copy_list_is_complete_and_importable(self):
        root = Path(__file__).resolve().parent.parent
        sources = []
        for line in (root / "Dockerfile").read_text().splitlines():
            if not line.startswith("COPY "):
                continue
            words = shlex.split(line)
            if words and words[0] == "COPY" and words[-1] == "/app/cloud115/":
                sources.extend(root / name for name in words[1:-1])
        self.assertTrue(sources, "Dockerfile must copy the worker modules")
        for source in sources:
            self.assertTrue(source.is_file(), f"Missing Docker COPY source: {source.name}")
        expected = {path.name for path in (root / "cloud115").glob("*.py") if not path.name.startswith("test_")}
        self.assertEqual({path.name for path in sources}, expected)
        # Import from only the packaged files so the source tree cannot hide
        # omissions, including modules imported lazily by individual operations.
        with tempfile.TemporaryDirectory() as directory:
            for source in sources:
                shutil.copy2(source, directory)
            modules = [path.stem for path in sources]
            script = f"import importlib; [importlib.import_module(name) for name in {modules!r}]"
            env = {**os.environ, "PYTHONPATH": directory, "PYTHONDONTWRITEBYTECODE": "1"}
            result = subprocess.run([sys.executable, "-c", script], cwd=directory, env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
