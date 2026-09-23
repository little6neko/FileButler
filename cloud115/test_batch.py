import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from batch import BatchOperations
from errors import Canceled, ProviderError


class MemoryCloud(BatchOperations):
    def __init__(self, directory):
        self.credentials = Path(directory) / "cookies"
        self.files = {"1": {"name": "a.jpg", "parent_id": "0", "is_dir": False}, "2": {"name": "b.jpg", "parent_id": "0", "is_dir": False}}
        self.client = SimpleNamespace(user_id=7, fs_rename=self.rename, fs_move=self.move)
        self.writes = []
        self.fail_name = None
        self.timeout_after_write = False

    def load(self):
        return self.client

    def info(self, file_id):
        return dict(self.files[file_id])

    def children(self, parent):
        return iter([{"id": key, "parentId": parent, "name": item["name"], "isDirectory": item["is_dir"]} for key, item in self.files.items() if item["parent_id"] == parent])

    def ensure_unused(self, parent, name, file_id=None):
        if any(entry["name"] == name and entry["id"] != file_id for entry in self.children(parent)):
            raise ProviderError("occupied")

    def checked(self, result):
        return result

    def rename(self, pair, **kwargs):
        file_id, name = pair
        if name == self.fail_name:
            self.fail_name = None
            raise ProviderError("injected failure")
        self.writes.append((file_id, name))
        self.files[file_id]["name"] = name
        if self.timeout_after_write:
            raise TimeoutError("response lost")
        return {}

    def move(self, file_id, pid, **kwargs):
        self.files[file_id]["parent_id"] = pid
        return {}

    def mkdir(self, parent, name):
        self.ensure_unused(parent, name)
        file_id = str(len(self.files) + 100)
        self.files[file_id] = {"name": name, "parent_id": parent, "is_dir": True}
        return file_id


def swap():
    return {"accountId": "7", "items": [
        {"id": "1", "parentId": "0", "name": "a.jpg", "targetName": "b.jpg", "destId": "0"},
        {"id": "2", "parentId": "0", "name": "b.jpg", "targetName": "a.jpg", "destId": "0"},
    ]}


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cloud = MemoryCloud(self.temp.name)

    def test_swap_and_verify_timeout_without_replaying_write(self):
        self.cloud.timeout_after_write = True
        self.cloud.batch_execute(swap(), lambda p: None)
        self.assertEqual(self.cloud.files["1"]["name"], "b.jpg")
        self.assertEqual(self.cloud.files["2"]["name"], "a.jpg")
        self.assertEqual(len(self.cloud.writes), 4)
        self.assertEqual(list(Path(self.temp.name).rglob("*.json")), [])

    def test_failed_finalize_recovers_original_names(self):
        self.cloud.fail_name = "a.jpg"
        with self.assertRaisesRegex(ProviderError, "原名称已恢复"):
            self.cloud.batch_execute(swap(), lambda p: None)
        self.assertEqual(self.cloud.files["1"]["name"], "a.jpg")
        self.assertEqual(self.cloud.files["2"]["name"], "b.jpg")

    def test_cancel_before_staging_does_not_mutate(self):
        def report(progress):
            if progress["phase"] == "waiting":
                raise Canceled()
        with self.assertRaises(Canceled):
            self.cloud.batch_execute(swap(), report)
        self.assertEqual(self.cloud.writes, [])

    def test_changed_source_or_account_rejected_before_write(self):
        self.cloud.files["1"]["name"] = "external.jpg"
        with self.assertRaisesRegex(ProviderError, "源文件"):
            self.cloud.batch_execute(swap(), lambda p: None)
        params = swap()
        params["accountId"] = "8"
        with self.assertRaisesRegex(ProviderError, "账号"):
            self.cloud.batch_execute(params, lambda p: None)
        self.assertEqual(self.cloud.writes, [])

    def test_occupied_destination_rejected(self):
        params = swap()
        params["items"] = params["items"][:1]
        with self.assertRaisesRegex(ProviderError, "占用"):
            self.cloud.batch_execute(params, lambda p: None)
        self.assertEqual(self.cloud.writes, [])

    def test_create_video_directory_and_move_verified_file(self):
        params = swap()
        params["items"] = [{**params["items"][0], "destId": "", "videoParentId": "0", "targetName": "V01.mp4"}]
        self.cloud.batch_execute(params, lambda p: None)
        video_parent = self.cloud.files["1"]["parent_id"]
        self.assertEqual(self.cloud.files[video_parent]["name"], "视频")
        self.assertEqual(self.cloud.files["1"]["name"], "V01.mp4")

    def test_duplicate_names_reject_scan(self):
        self.cloud.files["2"]["name"] = "a.jpg"
        with self.assertRaisesRegex(ProviderError, "同名"):
            self.cloud.batch_scan({"kind": "power", "ids": ["1"]})

    def test_changed_group_directory_is_rejected(self):
        self.cloud.files["10"] = {"name": "changed", "parent_id": "0", "is_dir": True}
        params = swap()
        params["guards"] = [{"id": "10", "parentId": "0", "name": "original"}]
        with self.assertRaisesRegex(ProviderError, "分组目录"):
            self.cloud.batch_execute(params, lambda p: None)
        self.assertEqual(self.cloud.writes, [])

    def test_unverifiable_mutation_keeps_recovery_record(self):
        original = self.cloud.info
        def info(file_id):
            if self.cloud.writes:
                raise TimeoutError("offline")
            return original(file_id)
        self.cloud.info = info
        with self.assertRaisesRegex(ProviderError, "恢复记录"):
            self.cloud.batch_execute(swap(), lambda p: None)
        records = list(Path(self.temp.name).rglob("*.json"))
        self.assertEqual(len(records), 1)
        self.assertIn('"pending"', records[0].read_text())
        self.assertEqual(records[0].stat().st_mode & 0o777, 0o600)
