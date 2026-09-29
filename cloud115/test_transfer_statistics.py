import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from errors import Canceled, ProviderError
import test_folder_download as fixtures


class TransferStatisticsTests(unittest.TestCase):
    def test_cloud_statistics_are_metadata_only_and_include_nested_files(self):
        ops = fixtures.FolderDownloadTests().make_ops()
        result = ops.operation("transfer.statistics", {"id": "1", "transferMethod": "download"}, lambda _: None)
        self.assertEqual(result, {"bytes": 10, "files": 2})
        ops.client.download_url.assert_not_called()
        ops.client.fs_category_get.assert_not_called()
        self.assertEqual(ops.operation("transfer.statistics", {"id": "2", "transferMethod": "download"}, lambda _: None), {"bytes": 4, "files": 1})

    def test_local_statistics_include_empty_files_not_empty_directories(self):
        ops = fixtures.FolderDownloadTests().make_ops()
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "sub").mkdir()
            Path(folder, "empty-dir").mkdir()
            Path(folder, "a.txt").write_bytes(b"abc")
            Path(folder, "sub/empty.txt").touch()
            with patch("builtins.open", side_effect=AssertionError("must not read content")):
                result = ops.operation("transfer.statistics", {"localPath": folder, "transferMethod": "upload"}, lambda _: None)
            self.assertEqual(result, {"bytes": 3, "files": 2})

    def test_canceled_or_failed_scan_never_returns_partial_totals(self):
        ops = fixtures.FolderDownloadTests().make_ops()
        def cancel(_): raise Canceled()
        with self.assertRaises(Canceled):
            ops.operation("transfer.statistics", {"id": "1"}, cancel)
        ops.children.side_effect = ProviderError("listing failed")
        with self.assertRaisesRegex(ProviderError, "listing failed"):
            ops.operation("transfer.statistics", {"id": "1"}, lambda _: None)
        ops.client.download_url.assert_not_called()

    def test_batch_folder_download_starts_without_waiting_for_statistics(self):
        ops = fixtures.FolderDownloadTests().make_ops()
        events = []
        with tempfile.TemporaryDirectory() as folder, patch("operations.urlopen", side_effect=fixtures.FolderDownloadTests().fetch):
            ops.operation("download", {"id": "1", "localPath": folder}, events.append)
            self.assertEqual(Path(folder, "album/a.txt").read_bytes(), b"abcd")
        complete = [p for p in events if p.get("fileComplete")]
        self.assertEqual([(p["fileId"], p["bytesDone"]) for p in complete], [("2", 4), ("4", 6)])
        self.assertEqual([str(call.args[0]) for call in ops.children.call_args_list], ["1", "3"])
        self.assertFalse(any(p["phase"] == "statistics" for p in events))

    def test_zero_files_and_failure_do_not_overcount_batch_leaves(self):
        ops = fixtures.FolderDownloadTests().make_ops()
        ops.nodes["2"]["size"] = 0
        events = []
        with tempfile.TemporaryDirectory() as folder, patch("operations.urlopen", side_effect=lambda *a, **kw: io.BytesIO(b"")):
            with self.assertRaisesRegex(ProviderError, "大小或摘要"):
                ops.operation("download", {"id": "1", "localPath": folder}, events.append)
        complete = [p for p in events if p.get("fileComplete")]
        self.assertEqual([p["fileId"] for p in complete], ["2"])
