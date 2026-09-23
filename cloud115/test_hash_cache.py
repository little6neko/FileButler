import hashlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from errors import Canceled, ProviderError
from operations import open_directory
from test_operations import FakeOperations

class MemoryCache:
    def __init__(self): self.records = {}; self.calls = []
    def call(self, method, params=None):
        self.calls.append((method, params))
        if method == "cache.warning": return
        key = (params.get("account", "local"), params.get("fileId", params.get("path")))
        if method == "hash.put": self.records[key] = dict(params)
        if method == "hash.get":
            old = self.records.get(key)
            return old["sha1"] if old and old["version"] == params["version"] else None
        if method == "hash.invalidate": self.records.pop(key, None)

class HashCacheTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(); self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name, "a.txt"); self.path.write_bytes(b"data")
        self.ops = FakeOperations(); self.ops.storage = MemoryCache()

    def upload(self, report=lambda p: None):
        with self.path.open("rb") as file: self.ops.upload_file(file, "a.txt", "0", report, str(self.path))

    def test_unchanged_upload_reuses_sha1_without_hashing_again(self):
        self.upload()
        # Mock SDK accepts precomputed hash without reading payload, like instant upload.
        self.ops.client = Mock()
        self.ops.client.upload_file.return_value = {"state": True}
        with self.path.open("rb") as file, patch("hash_cache.time.time_ns", return_value=self.path.stat().st_ctime_ns + 3_000_000_000), patch.object(file, "read", side_effect=AssertionError("unnecessary full-file read")):
            self.ops.upload_file(file, "a.txt", "0", lambda p: None, str(self.path))
        self.assertEqual(self.ops.client.upload_file.call_args.kwargs["filesha1"], hashlib.sha1(b"data").hexdigest().upper())

    def test_same_size_same_mtime_edit_invalidates_using_ctime(self):
        self.upload(); before = self.path.stat()
        self.path.write_bytes(b"EDIT"); os.utime(self.path, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.upload()
        self.assertEqual(self.ops.storage.records[("local", str(self.path))]["sha1"], hashlib.sha1(b"EDIT").hexdigest().upper())

    def test_same_path_replacement_never_reuses_old_hash(self):
        self.upload(); self.path.unlink(); self.path.write_bytes(b"next"); self.upload()
        self.assertEqual(self.ops.storage.records[("local", str(self.path))]["sha1"], hashlib.sha1(b"next").hexdigest().upper())

    def test_canceled_or_modified_hash_is_not_saved(self):
        for changed in (True, False):
            self.ops.storage = MemoryCache()
            def report(p):
                if p["phase"] == "hash" and p["bytesDone"] > 0:
                    if changed: self.path.write_bytes(b"changed")
                    else: raise Canceled()
            with self.assertRaises((Canceled, ProviderError)): self.upload(report)
            self.assertFalse(self.ops.storage.records)

    def test_cache_failure_does_not_fail_upload(self):
        self.ops.storage = Mock(); self.ops.storage.call.side_effect = ProviderError("unavailable")
        self.upload()

    def test_cloud_hash_is_account_scoped(self):
        item = {"id": "1", "sha1": hashlib.sha1(b"data").hexdigest(), "size": 4, "mtime": 1}
        for account in (7, 8):
            self.ops.client = Mock(user_id=account); self.ops.cloud_hash(item)
        self.assertEqual(set(self.ops.storage.records), {("7", "1"), ("8", "1")})

    def test_download_only_caches_published_complete_file(self):
        self.path.unlink()
        self.ops.client = Mock(); self.ops.client.download_url.return_value = "https://example.test/download"
        self.ops.info = lambda _: {"id": "1", "is_dir": False, "name": "a.txt", "size": 4, "pickcode": "p", "sha1": hashlib.sha1(b"data").hexdigest()}
        with open_directory(self.folder.name) as directory, patch("operations.urlopen", return_value=io.BytesIO(b"data")):
            self.ops.download_entry("1", directory, lambda p: None, self.folder.name)
        self.assertEqual(self.path.read_bytes(), b"data")
        self.assertEqual(self.ops.storage.records[("local", str(self.path))]["origin"], "download")
        self.path.unlink(); self.ops.storage.records.clear()
        with open_directory(self.folder.name) as directory, patch("operations.urlopen", return_value=io.BytesIO(b"bad")), self.assertRaises(ProviderError):
            self.ops.download_entry("1", directory, lambda p: None, self.folder.name)
        self.assertFalse(self.ops.storage.records)
        self.assertFalse(self.path.exists())
