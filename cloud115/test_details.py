import json
import threading
import unittest
from unittest.mock import Mock, patch
from details import FileDetails
from errors import Canceled, ProviderError


class Fake(FileDetails):
    def __init__(self):
        self.client = Mock(user_id=7)
        self.lock = threading.RLock()
        self.storage = Mock()
        self.storage.call.return_value = None
    def load(self):
        return self.client


class DetailsTests(unittest.TestCase):
    def setUp(self):
        self.ops = Fake()
        self.items = {
            1: {"id": 1, "parent_id": 0, "name": "a.txt", "size": 5, "is_dir": False, "mtime": 3, "sha1": "A" * 40},
            2: {"id": 2, "parent_id": 0, "name": "folder", "size": 0, "is_dir": True},
        }
        self.attrs = patch("p115client.tool.attr.get_attr", side_effect=lambda _, file_id, **kw: self.items[file_id]).start()
        patch("p115client.tool.attr.get_path", return_value="/parent").start()
        self.addCleanup(patch.stopall)
    def call(self, method, ids=None, report=lambda _: None):
        return self.ops.details(method, {"ids": ids or ["1"], "accountId": "7"}, report)
    def test_basic_does_not_populate_hash_cache(self):
        result = self.call("details.basic")
        self.assertEqual(result[0]["sha1"], "")
        self.assertIsNone(result[0]["allocated"])
        self.assertIsNone(result[0]["createdUnix"])
        self.assertEqual(result[0]["location"], "/parent")
        self.assertEqual(self.ops.storage.call.call_args.args[0], "hash.get")
        self.assertEqual(json.loads(self.ops.storage.call.call_args.args[1]["version"]), [5, 3, "A" * 40])
    def test_explicit_hash_refreshes_server_value(self):
        self.assertEqual(self.call("details.hash"), {"sha1": "A" * 40})
        self.assertEqual(self.ops.storage.call.call_args.args[0], "hash.put")
        self.attrs.assert_called_once()
    def test_missing_remote_hash_invalidates_old_cache(self):
        self.items[1]["sha1"] = ""
        self.assertEqual(self.call("details.hash"), {"sha1": ""})
        self.assertEqual(self.ops.storage.call.call_args.args[0], "hash.invalidate")
    def test_account_change_rejected_before_reading(self):
        self.ops.client.user_id = 8
        with self.assertRaises(ProviderError): self.call("details.basic")
        self.attrs.assert_not_called()
    def test_stats_counts_selected_folder_and_deduplicates_children(self):
        self.ops.browse = Mock(return_value={"entries": [{"id": "1", "isDirectory": False, "size": 5}], "total": 1})
        result = self.call("details.stats", ["1", "2"])
        self.assertEqual(result, {"size": 5, "allocated": None, "files": 1, "folders": 1})
        self.assertEqual(self.call("details.stats", ["2"])["folders"], 0)
    def test_cancel_stops_scan(self):
        def canceled(_): raise Canceled()
        with self.assertRaises(Canceled): self.call("details.stats", ["2"], canceled)
        self.attrs.assert_not_called()
    def test_incomplete_page_is_not_a_total(self):
        self.ops.browse = Mock(return_value={"entries": [], "total": 1})
        with self.assertRaises(ProviderError): self.call("details.stats", ["2"])
    def test_root_statistics_recurse_and_count_exact_bytes(self):
        pages = {
            "0": [{"id": "2", "isDirectory": True, "size": 0}],
            "2": [{"id": "1", "isDirectory": False, "size": 12345}],
        }
        self.ops.browse = lambda file_id, offset: {"entries": pages[file_id], "total": len(pages[file_id])}
        self.ops.client.fs_category_get.side_effect = AssertionError("rounded statistics must not be used")
        self.assertEqual(self.call("details.stats", ["0"]), {"size": 12345, "allocated": None, "files": 1, "folders": 1})


if __name__ == "__main__": unittest.main()
