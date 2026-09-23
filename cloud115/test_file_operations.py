import copy
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from errors import Canceled, ProviderError
from operations import CloudOperations
from file_operations import local_snapshot, remove_local_snapshot
from accounts import AccountContext


class FakeShared(CloudOperations):
    checked = staticmethod(AccountContext.checked)

    def __init__(self):
        self.nodes = {"1": {"id": "1", "name": "a.txt", "parent_id": "0", "size": 4, "mtime": 1, "is_dir": False, "sha1": "abc"}, "9": {"id": "9", "name": "dest", "parent_id": "0", "is_dir": True}}
        self.client = Mock(user_id=7)
        self.client.fs_delete.side_effect = self.delete

    def load(self): return self.client
    def info(self, file_id): return copy.deepcopy(self.nodes[str(file_id)])
    def children(self, parent, checkpoint=lambda: None):
        checkpoint()
        return [{"id": key, "name": node["name"], "isDirectory": node["is_dir"]} for key, node in self.nodes.items() if str(node["parent_id"]) == str(parent)]
    def delete(self, file_id, **kwargs):
        del self.nodes[str(file_id)]
        return {"state": True}


class SharedOperationsTests(unittest.TestCase):
    def test_cloud_previews_never_visit_source_descendants(self):
        for operation in ("copy", "move", "delete"):
            with self.subTest(operation=operation):
                ops = FakeShared()
                ops.nodes["2"] = {"id": "2", "name": "album", "parent_id": "0", "is_dir": True}
                for index in range(300):
                    ops.nodes[str(index + 100)] = {**ops.nodes["1"], "id": str(index + 100), "name": f"{index}.txt", "parent_id": "2"}
                original = ops.children
                def children(parent, checkpoint=lambda: None):
                    self.assertNotEqual(str(parent), "2", "preview scanned the source folder")
                    return original(parent)
                with patch.object(ops, "children", side_effect=children), patch.object(ops, "cloud_snapshot", side_effect=AssertionError("recursive preview")):
                    params = {"type": operation, "accountId": "7", "sourceCloud": True, "targetCloud": True, "sources": [{"id": "2"}], "destId": "9"}
                    plan = ops.operation_plan(params)
                    self.assertFalse(plan["hasConflict"])
                    self.assertEqual(len(plan["items"]), 1)
                    self.assertNotIn("snapshot", plan["entries"][0])
                    ops.nodes["100"]["mtime"] = 99
                    self.assertEqual(plan["revision"], ops.operation_plan(params)["revision"])
                    with patch.object(ops, "operation", return_value={"ok": True}):
                        ops.operation_execute(plan["entries"][0], lambda p: None)

    def test_transfer_previews_do_not_take_recursive_snapshots(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder, "source"); source.mkdir()
            (source / "child").write_text("data")
            ops = FakeShared()
            for source_cloud in (False, True):
                params = {"type": "move", "accountId": "7", "sourceCloud": source_cloud, "targetCloud": not source_cloud,
                          "sources": [{"id": "9"}] if source_cloud else [{"localPath": str(source)}], "destId": "9", "localDest": folder}
                with patch("file_operations.local_snapshot", side_effect=AssertionError("recursive local preview")), patch.object(ops, "cloud_snapshot", side_effect=AssertionError("recursive cloud preview")):
                    plan = ops.operation_plan(params)
                self.assertFalse(plan["hasConflict"])
                self.assertNotIn("snapshot", plan["entries"][0])

    def test_nested_cloud_selection_is_rejected_in_either_order_without_descendant_scan(self):
        for ids in (["9", "1"], ["1", "9"]):
            ops = FakeShared(); ops.nodes["1"]["parent_id"] = "9"
            with patch.object(ops, "children", side_effect=AssertionError("scanned descendants")):
                plan = ops.operation_plan({"type": "delete", "accountId": "7", "sourceCloud": True, "targetCloud": True, "sources": [{"id": id} for id in ids]})
            self.assertTrue(plan["hasConflict"])
            self.assertTrue(any("嵌套" in item.get("errorText", "") for item in plan["items"]))

    def test_canceled_preview_stops_before_next_network_read(self):
        ops = FakeShared()
        def canceled(): raise Canceled()
        with patch.object(ops, "info") as info, self.assertRaises(Canceled):
            ops.operation_plan({"type": "move", "accountId": "7", "sourceCloud": True, "targetCloud": True, "sources": [{"id": "1"}], "destId": "9"}, checkpoint=canceled)
        info.assert_not_called()

    def test_cloud_move_checks_the_selected_item_before_execution(self):
        for change in ("name", "parent_id"):
            ops = FakeShared()
            plan = ops.operation_plan({"type": "move", "accountId": "7", "sourceCloud": True, "targetCloud": True, "sources": [{"id": "1"}], "destId": "9"})
            ops.nodes["1"][change] = "changed" if change == "name" else "9"
            with patch.object(ops, "operation") as execute, self.assertRaises(ProviderError):
                ops.operation_execute(plan["entries"][0], lambda p: None)
            execute.assert_not_called()

    def test_move_still_rejects_destination_inside_source_without_scanning_source(self):
        ops = FakeShared()
        ops.nodes["2"] = {"id": "2", "name": "source", "parent_id": "0", "is_dir": True}
        ops.nodes["9"]["parent_id"] = "2"
        with patch.object(ops, "cloud_snapshot", side_effect=AssertionError("recursive preview")):
            plan = ops.operation_plan({"type": "move", "accountId": "7", "sourceCloud": True, "targetCloud": True, "sources": [{"id": "2"}], "destId": "9"})
        self.assertTrue(plan["hasConflict"])
        self.assertIn("子目录", plan["items"][0]["errorText"])

    def test_upload_subtree_validation_is_deferred_until_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder, "source"); source.mkdir()
            (source / "link").symlink_to(Path(folder, "outside"))
            ops = FakeShared()
            plan = ops.operation_plan({"type": "move", "accountId": "7", "sourceCloud": False, "targetCloud": True, "sources": [{"localPath": str(source)}], "destId": "9"})
            self.assertFalse(plan["hasConflict"])
            with patch.object(ops, "operation") as transfer, self.assertRaisesRegex(ProviderError, "符号链接"):
                ops.operation_execute(plan["entries"][0], lambda p: None)
            transfer.assert_not_called()
            self.assertTrue(source.exists())

    def test_preview_is_read_only_and_rejects_same_directory_and_conflicts(self):
        ops = FakeShared()
        params = {"type": "move", "accountId": "7", "sourceCloud": True, "targetCloud": True, "sources": [{"id": "1"}], "destId": "0"}
        plan = ops.operation_plan(params)
        self.assertTrue(plan["hasConflict"])
        self.assertIn("当前", plan["items"][0]["errorText"])
        params["destId"] = "9"
        self.assertFalse(ops.operation_plan(params)["hasConflict"])
        ops.client.fs_delete.assert_not_called()
        ops.client.fs_move.assert_not_called()
        params["accountId"] = "other"
        with self.assertRaises(ProviderError): ops.operation_plan(params)

    def test_download_copy_and_move_delete_only_after_success(self):
        for operation in ("copy", "move"):
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as dest:
                ops = FakeShared()
                plan = ops.operation_plan({"type": operation, "accountId": "7", "sourceCloud": True, "targetCloud": False, "sources": [{"id": "1"}], "localDest": dest})
                def transfer(method, params, report):
                    self.assertEqual(method, "download")
                    ops.client.fs_delete.assert_not_called()
                    Path(dest, "a.txt").write_text("data")
                with patch.object(ops, "operation", side_effect=transfer):
                    ops.operation_execute(plan["entries"][0], lambda p: None)
                self.assertEqual(Path(dest, "a.txt").read_text(), "data")
                self.assertEqual("1" in ops.nodes, operation == "copy")

    def test_failed_canceled_or_changed_download_keeps_source(self):
        for reason in ("failure", "cancel", "changed", "delete-failure"):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as dest:
                ops = FakeShared()
                plan = ops.operation_plan({"type": "move", "accountId": "7", "sourceCloud": True, "targetCloud": False, "sources": [{"id": "1"}], "localDest": dest})
                def transfer(*args):
                    Path(dest, "a.txt").write_text("data")
                    if reason == "failure": raise ProviderError("download failed")
                    if reason == "changed": ops.nodes["1"]["mtime"] = 2
                def report(p):
                    if reason == "cancel" and p["phase"] == "delete-source": raise Canceled()
                if reason == "delete-failure": ops.client.fs_delete.side_effect = ProviderError("delete failed")
                with patch.object(ops, "operation", side_effect=transfer), self.assertRaises((ProviderError, Canceled)):
                    ops.operation_execute(plan["entries"][0], report)
                self.assertIn("1", ops.nodes)
                self.assertTrue(Path(dest, "a.txt").exists())

    def test_upload_move_removes_only_complete_unchanged_source_tree(self):
        for changed in (False, True):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as folder:
                source = Path(folder, "tree"); source.mkdir(); (source / "a").write_text("data")
                ops = FakeShared()
                plan = ops.operation_plan({"type": "move", "accountId": "7", "sourceCloud": False, "targetCloud": True, "sources": [{"localPath": str(source)}], "destId": "9"})
                def upload(method, params, report):
                    self.assertEqual(method, "upload")
                    self.assertTrue(source.exists())
                    if changed: (source / "new").write_text("keep")
                    ops.nodes["10"] = {"id": "10", "name": "tree", "parent_id": "9", "is_dir": True}
                    ops.nodes["11"] = {"id": "11", "name": "a", "parent_id": "10", "is_dir": False, "size": 4}
                with patch.object(ops, "operation", side_effect=upload):
                    if changed:
                        with self.assertRaisesRegex(ProviderError, "删除失败"):
                            ops.operation_execute(plan["entries"][0], lambda p: None)
                    else: ops.operation_execute(plan["entries"][0], lambda p: None)
                self.assertEqual(source.exists(), changed)
                if changed: self.assertEqual((source / "new").read_text(), "keep")

    def test_cloud_directory_gaining_a_child_is_not_deleted(self):
        with tempfile.TemporaryDirectory() as dest:
            ops = FakeShared()
            ops.nodes["1"]["parent_id"] = "9"
            plan = ops.operation_plan({"type": "move", "accountId": "7", "sourceCloud": True, "targetCloud": False, "sources": [{"id": "9"}], "localDest": dest})
            def download(*args): ops.nodes["2"] = {**ops.nodes["1"], "id": "2", "name": "new.txt"}
            with patch.object(ops, "operation", side_effect=download), self.assertRaisesRegex(ProviderError, "删除失败"):
                ops.operation_execute(plan["entries"][0], lambda p: None)
            ops.client.fs_delete.assert_not_called()

    def test_local_replacement_and_links_cannot_be_deleted(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, "a"); path.write_text("before")
            snapshot = local_snapshot(str(path))
            path.unlink(); path.write_text("replacement")
            with self.assertRaises(ProviderError): remove_local_snapshot(str(path), snapshot, lambda p: None)
            self.assertEqual(path.read_text(), "replacement")
            link = Path(folder, "link"); link.symlink_to(path)
            with self.assertRaises(ProviderError): local_snapshot(str(link))

    def test_incomplete_download_never_deletes_cloud_source(self):
        for contents in (None, "short"):
            with self.subTest(contents=contents), tempfile.TemporaryDirectory() as dest:
                ops = FakeShared()
                plan = ops.operation_plan({"type": "move", "accountId": "7", "sourceCloud": True, "targetCloud": False, "sources": [{"id": "1"}], "localDest": dest})
                def download(*args):
                    if contents is not None: Path(dest, "a.txt").write_text(contents)
                with patch.object(ops, "operation", side_effect=download), self.assertRaises(ProviderError):
                    ops.operation_execute(plan["entries"][0], lambda p: None)
                ops.client.fs_delete.assert_not_called()

    def test_incomplete_upload_never_deletes_local_source(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder, "tree"); source.mkdir(); (source / "a").write_text("data")
            ops = FakeShared()
            plan = ops.operation_plan({"type": "move", "accountId": "7", "sourceCloud": False, "targetCloud": True, "sources": [{"localPath": str(source)}], "destId": "9"})
            def upload(*args):
                ops.nodes["10"] = {"id": "10", "name": "tree", "parent_id": "9", "is_dir": True}
            with patch.object(ops, "operation", side_effect=upload), self.assertRaises(ProviderError):
                ops.operation_execute(plan["entries"][0], lambda p: None)
            self.assertEqual((source / "a").read_text(), "data")

    def test_cloud_internal_operations_delegate_without_transferring_bytes(self):
        for operation in ("copy", "move", "delete"):
            with self.subTest(operation=operation):
                ops = FakeShared()
                plan = ops.operation_plan({"type": operation, "accountId": "7", "sourceCloud": True, "targetCloud": True, "sources": [{"id": "1"}], "destId": "9"})
                report = Mock()
                with patch.object(ops, "operation", return_value={"ok": True}) as execute:
                    ops.operation_execute(plan["entries"][0], report)
                execute.assert_called_once_with(operation, {"id": "1", "destId": "9"}, report)

    def test_successful_cloud_directory_move_deletes_leaves_first(self):
        with tempfile.TemporaryDirectory() as dest:
            ops = FakeShared(); ops.nodes["1"]["parent_id"] = "9"
            plan = ops.operation_plan({"type": "move", "accountId": "7", "sourceCloud": True, "targetCloud": False, "sources": [{"id": "9"}], "localDest": dest})
            def download(*args):
                Path(dest, "dest").mkdir()
                Path(dest, "dest", "a.txt").write_text("data")
            with patch.object(ops, "operation", side_effect=download):
                ops.operation_execute(plan["entries"][0], lambda p: None)
            self.assertEqual([call.args[0] for call in ops.client.fs_delete.call_args_list], ["1", "9"])
