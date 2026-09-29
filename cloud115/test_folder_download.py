import copy
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from errors import Canceled, ProviderError
from test_operations import FakeOperations


class FolderDownloadTests(unittest.TestCase):
    def make_ops(self):
        client = Mock(user_id=7)
        client.fs_category_get.side_effect = AssertionError("rounded statistics must not be used")
        client.download_url.side_effect = lambda pc, **kw: "https://example.invalid/" + pc
        ops = FakeOperations(client)
        nodes = {
            "1": {"id": "1", "parent_id": "0", "name": "album", "is_dir": True},
            "2": {"id": "2", "parent_id": "1", "name": "a.txt", "is_dir": False, "size": 4, "pickcode": "a"},
            "3": {"id": "3", "parent_id": "1", "name": "sub", "is_dir": True},
            "4": {"id": "4", "parent_id": "3", "name": "b.txt", "is_dir": False, "size": 6, "pickcode": "b"},
        }
        ops.nodes = nodes
        ops.info = lambda file_id: copy.deepcopy(nodes[str(file_id)])
        def children(parent, checkpoint=lambda: None):
            checkpoint()
            return [{"id": key, "parentId": value["parent_id"], "name": value["name"], "isDirectory": value["is_dir"], "size": value.get("size", 0)} for key, value in nodes.items() if value["parent_id"] == str(parent)]
        ops.children = Mock(side_effect=children)
        return ops

    def fetch(self, req, **kwargs):
        return io.BytesIO(b"abcd" if req.full_url.endswith("/a") else b"123456")

    def test_download_reports_stable_leaf_ids_for_job_aggregation(self):
        ops = self.make_ops()
        events = []
        with tempfile.TemporaryDirectory() as dest, patch("operations.urlopen", side_effect=self.fetch):
            ops.operation("download", {"id": "1", "localPath": dest}, events.append)
            self.assertEqual(Path(dest, "album/a.txt").read_bytes(), b"abcd")
            self.assertEqual(Path(dest, "album/sub/b.txt").read_bytes(), b"123456")
        progress = [e for e in events if e["phase"] == "download"]
        self.assertTrue(progress)
        complete = [e for e in progress if e.get("fileComplete")]
        self.assertEqual([(e["fileId"], e["bytesDone"]) for e in complete], [("2", 4), ("4", 6)])
        self.assertEqual(sum(e["bytesDone"] for e in complete), 10)
        self.assertFalse(any("filesTotal" in e for e in progress))
        self.assertEqual([str(call.args[0]) for call in ops.children.call_args_list], ["1", "3"])
        ops.client.fs_category_get.assert_not_called()

    def test_download_starts_before_listing_later_subfolders(self):
        ops = self.make_ops()
        with tempfile.TemporaryDirectory() as dest, patch("operations.urlopen", side_effect=self.fetch):
            original = ops.children.side_effect
            def children(parent, checkpoint=lambda: None):
                if str(parent) == "3":
                    self.assertEqual(Path(dest, "album/a.txt").read_bytes(), b"abcd")
                return original(parent, checkpoint)
            ops.children.side_effect = children
            ops.operation("download", {"id": "1", "localPath": dest}, lambda _: None)

    def test_empty_folder_is_created_without_fake_leaf_completion(self):
        ops = self.make_ops()
        ops.children = lambda _, checkpoint=lambda: None: []
        events = []
        with tempfile.TemporaryDirectory() as dest:
            ops.operation("download", {"id": "1", "localPath": dest}, events.append)
            self.assertTrue(Path(dest, "album").is_dir())
        self.assertFalse(any(e.get("fileComplete") for e in events))

    def test_zero_byte_files_are_counted_after_publication(self):
        ops = self.make_ops()
        ops.nodes["2"]["size"] = ops.nodes["4"]["size"] = 0
        with tempfile.TemporaryDirectory() as dest, patch("operations.urlopen", side_effect=lambda *a, **k: io.BytesIO(b"")):
            events = []
            def report(event):
                events.append(event)
                if event.get("fileComplete") and event["fileId"] == "2":
                    self.assertTrue(Path(dest, "album/a.txt").is_file())
                if event.get("fileComplete") and event["fileId"] == "4":
                    self.assertTrue(Path(dest, "album/sub/b.txt").is_file())
            ops.operation("download", {"id": "1", "localPath": dest}, report)
        self.assertEqual([e["fileId"] for e in events if e.get("fileComplete")], ["2", "4"])

    def test_failed_file_is_not_counted_as_complete(self):
        ops = self.make_ops()
        events = []
        def fetch(req, **kw):
            return io.BytesIO(b"abcd" if req.full_url.endswith("/a") else b"short")
        with tempfile.TemporaryDirectory() as dest, patch("operations.urlopen", side_effect=fetch):
            with self.assertRaisesRegex(ProviderError, "大小或摘要校验失败"):
                ops.operation("download", {"id": "1", "localPath": dest}, events.append)
            self.assertTrue(Path(dest, "album/a.txt").is_file())
            self.assertEqual(list(Path(dest, "album/sub").iterdir()), [])
        self.assertEqual([e["fileId"] for e in events if e.get("fileComplete")], ["2"])

    def test_canceled_statistics_do_not_start_downloading(self):
        ops = self.make_ops()
        def report(event):
            if event["phase"] == "statistics":
                raise Canceled()
        with tempfile.TemporaryDirectory() as dest, patch("operations.urlopen", side_effect=self.fetch) as fetch:
            with self.assertRaises(Canceled):
                ops.operation("transfer.statistics", {"id": "1", "transferMethod": "download"}, report)
            self.assertEqual(list(Path(dest).iterdir()), [])
            fetch.assert_not_called()

    def test_failed_listing_is_not_used_as_a_partial_total(self):
        ops = self.make_ops()
        ops.children.side_effect = ProviderError("GET https://webapi.115.com/files\nHTTP 405 Method Not Allowed")
        with tempfile.TemporaryDirectory() as dest, patch("operations.urlopen") as fetch:
            with self.assertRaisesRegex(ProviderError, "HTTP 405"):
                ops.operation("download", {"id": "1", "localPath": dest}, lambda _: None)
            self.assertEqual([p.name for p in Path(dest).iterdir()], ["album"])
            self.assertEqual(list(Path(dest, "album").iterdir()), [])
            fetch.assert_not_called()

    def test_repeated_directory_id_is_rejected_while_streaming(self):
        ops = self.make_ops()
        ops.children.side_effect = lambda _, checkpoint=lambda: None: [{"id": "1"}]
        with tempfile.TemporaryDirectory() as dest, patch("operations.urlopen") as fetch:
            with self.assertRaisesRegex(ProviderError, "目录层级异常"):
                ops.operation("download", {"id": "1", "localPath": dest}, lambda _: None)
            fetch.assert_not_called()
