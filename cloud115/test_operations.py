import hashlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

from errors import Canceled, DiagnosticResponse, ProviderError
from operations import CloudOperations, open_directory, safe_name
from accounts import AccountContext


class FakeClient:
    def __init__(self, reuse=False):
        self.reuse = reuse
        self.password = None
        self.extracted = False
        self.progress_calls = 0

    def upload_file(self, file, **kwargs):
        assert kwargs["filesha1"] == hashlib.sha1(file.read()).hexdigest().upper()
        if not self.reuse:
            kwargs["reporthook"](kwargs["filesize"])
        return {"state": True, "reuse": self.reuse}

    def extract_push(self, params, **kwargs):
        self.password = params["secret"]
        return {"state": True, "data": {"unzip_status": 4}}

    def extract_file(self, pickcode, **kwargs):
        self.extracted = True
        return {"state": True, "data": {"extract_id": "task"}}

    def extract_progress(self, task_id, **kwargs):
        self.progress_calls += 1
        return {"state": True, "data": {"percent": 50 if self.progress_calls == 1 else 100}}


class FakeOperations(CloudOperations):
    checked = staticmethod(AccountContext.checked)

    def __init__(self, client=None):
        self.client = client or FakeClient()

    def load(self):
        return self.client

    def mkdir(self, parent, name):
        return "new-directory"


class OperationsTests(unittest.TestCase):
    def test_offline_quota_reads_current_totals_without_submitting_or_listing(self):
        client = Mock()
        # Totals include bonus packages; these are not necessarily monthly totals.
        client.clouddownload_request.return_value = {"count": "3000", "used": 434, "surplus": 2566, "package": {"1": {"name": "VIP配额"}, "3": {"name": "赠送配额"}}}
        result = FakeOperations(client).operation("offline.quota", {"accountId": "1"}, Mock())
        self.assertEqual(result, {"total": 3000, "used": 434, "remaining": 2566})
        client.clouddownload_request.assert_called_once_with(action="get_quota_package_info", method="GET", timeout=20)
        client.clouddownload_task_add_url.assert_not_called()
        client.fs_files.assert_not_called()

    def test_offline_quota_accepts_zero_and_rejects_missing_or_invalid_counts(self):
        client = Mock()
        operations = FakeOperations(client)
        client.clouddownload_request.return_value = {"count": 0, "used": 0, "surplus": 0}
        self.assertEqual(operations.operation("offline.quota", {}, Mock()), {"total": 0, "used": 0, "remaining": 0})
        for key in ("count", "used", "surplus"):
            for value in (None, True, -1, 1.5, "NaN", "", "-1", 2**53):
                with self.subTest(key=key, value=value):
                    client.clouddownload_request.return_value = {"count": 10, "used": 1, "surplus": 9, key: value}
                    with self.assertRaisesRegex(ProviderError, "配额"):
                        operations.operation("offline.quota", {}, Mock())
        client.clouddownload_request.return_value = {"state": True, "data": {}}
        with self.assertRaisesRegex(ProviderError, "配额"):
            operations.operation("offline.quota", {}, Mock())
        client.clouddownload_request.return_value = {"state": False, "errno": 911, "message": "验证失败"}
        with self.assertRaisesRegex(ProviderError, "911"):
            operations.operation("offline.quota", {}, Mock())

    def test_move_checks_original_id_without_listing_destination_after_mutation(self):
        for is_directory in (False, True):
            for destination in ("0", "9"):
                with self.subTest(directory=is_directory, destination=destination):
                    client = Mock()
                    operations = FakeOperations(client)
                    item = {"id": 1, "name": "target", "is_dir": is_directory, "parent_id": 2}
                    inspected = []
                    def info(file_id):
                        inspected.append(str(file_id))
                        return dict(item) if str(file_id) == "1" else {"parent_id": 0, "is_dir": True}
                    def browse(parent, offset=0, checkpoint=lambda: None):
                        self.assertEqual(parent, destination)
                        if client.fs_move.called:
                            raise ProviderError("目录在读取时发生变化，请重新加载")
                        return {"entries": [], "total": 0, "offset": offset}
                    def move(file_id, pid, **kwargs):
                        self.assertEqual(file_id, 1)
                        self.assertEqual(pid, destination)
                        item["parent_id"] = int(pid)
                        return {"state": True}
                    client.fs_move.side_effect = move
                    with patch.object(operations, "info", side_effect=info), patch.object(operations, "browse", side_effect=browse) as listing:
                        result = operations.operation("move", {"id": "1", "destId": destination}, lambda p: None)
                    self.assertEqual(result, {"ok": True})
                    self.assertEqual(listing.call_count, 1)  # Keep the pre-move name check.
                    self.assertEqual(inspected.count("1"), 2)
                    self.assertEqual(inspected[-1], "1")
                    client.fs_move.assert_called_once_with(1, pid=destination, timeout=30)

    def test_move_rejects_success_response_when_original_id_still_has_old_parent(self):
        client = Mock()
        client.fs_move.return_value = {"state": True}
        operations = FakeOperations(client)
        item = {"id": "1", "name": "target", "is_dir": False, "parent_id": "2"}
        with patch.object(operations, "info", return_value=item), patch.object(operations, "browse", return_value={"entries": [], "total": 0}):
            with self.assertRaisesRegex(ProviderError, "115尚未确认移动完成"):
                operations.operation("move", {"id": "1", "destId": "9"}, lambda p: None)

    def test_move_name_conflict_prevents_remote_mutation(self):
        client = Mock()
        operations = FakeOperations(client)
        item = {"id": "1", "name": "target", "is_dir": False, "parent_id": "2"}
        page = {"entries": [{"id": "3", "name": "target"}], "total": 1}
        with patch.object(operations, "info", return_value=item), patch.object(operations, "browse", return_value=page):
            with self.assertRaisesRegex(ProviderError, "目标已存在"):
                operations.operation("move", {"id": "1", "destId": "9"}, lambda p: None)
        client.fs_move.assert_not_called()

    def test_copy_still_confirms_new_entry_in_destination(self):
        client = Mock()
        client.fs_copy.return_value = {"state": True}
        operations = FakeOperations(client)
        item = {"id": "1", "name": "target", "is_dir": False, "parent_id": "2"}
        pages = [{"entries": [], "total": 0}, {"entries": [{"id": "3", "name": "target"}], "total": 1}]
        with patch.object(operations, "info", return_value=item), patch.object(operations, "browse", side_effect=pages) as listing:
            self.assertEqual(operations.operation("copy", {"id": "1", "destId": "9"}, lambda p: None), {"ok": True})
            self.assertEqual(listing.call_count, 2)
        client.fs_copy.assert_called_once_with("1", pid="9", timeout=30)

    def test_preview_url_never_fetches_bytes_or_exposes_headers(self):
        class URL(str):
            headers = {"User-Agent": "Browser-UA"}
        client = Mock(user_id=7)
        client.download_url.return_value = URL("https://cdn.example/file?f=1&t=9999999999")
        operations = FakeOperations(client)
        with patch.object(operations, "info", return_value={"is_dir": False, "pickcode": "pc", "name": "a.jpg", "size": 42}), patch("operations.urlopen") as fetch:
            result = operations.operation("preview.url", {"id": "1", "userAgent": "Browser-UA"}, None)
        self.assertEqual(set(result), {"url", "name", "size", "accountId"})
        self.assertEqual(result["accountId"], "7")
        client.download_url.assert_called_once_with("pc", user_agent="Browser-UA", app="android", timeout=30)
        fetch.assert_not_called()

    def test_preview_url_rejects_cookie_bound_or_unsafe_urls(self):
        class URL(str):
            headers = {}
        client = Mock(user_id=7)
        operations = FakeOperations(client)
        for value in ("https://cdn.example/file?f=3", "javascript:alert(1)", "https://user:password@cdn.example/file"):
            client.download_url.return_value = URL(value)
            with patch.object(operations, "info", return_value={"is_dir": False, "pickcode": "pc", "name": "a.jpg"}), self.assertRaises(ProviderError):
                operations.operation("preview.url", {"id": "1"}, None)
        value = URL("https://cdn.example/file")
        value.headers = {"Cookie": "secret"}
        client.download_url.return_value = value
        with patch.object(operations, "info", return_value={"is_dir": False, "pickcode": "pc", "name": "a.jpg"}), self.assertRaisesRegex(ProviderError, "额外认证"):
            operations.operation("preview.url", {"id": "1"}, None)

    def test_paginated_directory_changes_are_not_treated_as_complete(self):
        operations = FakeOperations()
        for second in (
            {"entries": [{"id": "2"}], "total": 3},
            {"entries": [{"id": "1"}], "total": 2},
        ):
            with patch.object(operations, "browse", side_effect=[{"entries": [{"id": "1"}], "total": 2}, second]):
                with self.assertRaises(ProviderError):
                    list(operations.children("0"))

    def test_resolve_uses_exact_names_and_rejects_ambiguous_paths(self):
        operations = FakeOperations()
        with patch.object(operations, "children", return_value=iter([{"id": "12", "name": "林幼一(唐宁宁)", "isDirectory": True}])):
            result = operations.operation("resolve", {"path": "/林幼一(唐宁宁)"}, None)
        self.assertEqual(result["trail"][-1]["id"], "12")
        with patch.object(operations, "children", return_value=iter([{"id": "12", "name": "same", "isDirectory": True}, {"id": "13", "name": "same", "isDirectory": True}])), self.assertRaises(ProviderError):
            operations.operation("resolve", {"path": "same"}, None)

    def test_offline_submission_uses_selected_directory(self):
        client = Mock()
        client.clouddownload_task_add_url.return_value = {"state": True}
        operations = FakeOperations(client)
        with patch.object(operations, "info", return_value={"is_dir": True}):
            result = operations.operation("offline.add", {"url": "magnet:?xt=test", "destId": "123"}, None)
        self.assertEqual(result, {"submitted": True})
        client.clouddownload_task_add_url.assert_called_once_with({"url": "magnet:?xt=test", "wp_path_id": "123"}, timeout=30)

    def test_offline_failure_and_invalid_destination(self):
        client = Mock()
        operations = FakeOperations(client)
        with patch.object(operations, "info", return_value={"is_dir": False}), self.assertRaises(ProviderError):
            operations.operation("offline.add", {"url": "magnet:?xt=test", "destId": "123"}, None)
        client.clouddownload_task_add_url.assert_not_called()
        client.clouddownload_task_add_url.return_value = {"state": False, "errno": 10008}
        with self.assertRaises(ProviderError):
            operations.operation("offline.add", {"url": "magnet:?xt=test", "destId": "0"}, None)

    def test_hash_and_upload_progress_and_instant_upload(self):
        for reuse in (True, False):
            with self.subTest(reuse=reuse), tempfile.TemporaryFile() as file:
                file.write(b"data" * 600000)
                file.seek(0)
                progress = []
                FakeOperations(FakeClient(reuse)).upload_file(file, "test.txt", "0", progress.append)
                hashes = [p for p in progress if p["phase"] == "hash"]
                self.assertEqual(hashes[-1]["bytesDone"], 2400000)
                self.assertEqual(any(p["phase"] == "upload" for p in progress), not reuse)

    def test_hash_cancellation(self):
        with tempfile.TemporaryFile() as file:
            file.write(b"test")
            file.seek(0)
            def cancel(progress):
                if progress["bytesDone"]:
                    raise Canceled()
            with self.assertRaises(Canceled):
                FakeOperations().upload_file(file, "test", "0", cancel)

    def test_changed_file_is_rejected_before_upload(self):
        with tempfile.TemporaryFile() as file:
            file.write(b"test")
            file.seek(0)
            def change(progress):
                if progress["bytesDone"]:
                    os.ftruncate(file.fileno(), 0)
            with self.assertRaises(ProviderError):
                FakeOperations().upload_file(file, "test", "0", change)

    def test_path_traversal_and_symlink_rejected(self):
        for name in ("..", ".", "", "a/b", "a\\b", "\x00"):
            with self.assertRaises(ProviderError):
                safe_name(name)
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            Path(root, "link").symlink_to(outside)
            with self.assertRaises(OSError):
                with open_directory(str(Path(root, "link"))):
                    self.fail("followed symbolic link")

    def test_encrypted_extraction_waits_until_second_stage_completed(self):
        operations = FakeOperations()
        progress = []
        with patch("operations.time.sleep"):
            operations.extract({"is_dir": False, "name": "test.zip", "pickcode": "pick"}, "0", "test-password", progress.append)
        self.assertEqual(operations.client.password, "test-password")
        self.assertTrue(operations.client.extracted)
        self.assertEqual(operations.client.progress_calls, 2)
        self.assertEqual(progress[-1]["percent"], 100)
        self.assertTrue(all(not p["cancelable"] for p in progress))
        self.assertNotIn("test-password", str(progress))

    def test_extraction_missing_submission_status_queries_progress_without_resubmitting(self):
        for response in ({"state": True}, {"state": True, "data": {}}, {"state": True, "data": None}):
            with self.subTest(response=response):
                operations = FakeOperations()
                client = operations.client
                client.extract_push = Mock(return_value=response)
                client.extract_push_progress = Mock()
                progress = []
                with patch("operations.time.sleep"), patch.object(operations, "mkdir", return_value="folder") as mkdir:
                    def query(*args, **kwargs):
                        mkdir.assert_not_called()
                        return {"state": True, "data": {"unzip_status": "4" if client.extract_push_progress.call_count == 2 else "1"}}
                    client.extract_push_progress.side_effect = query
                    operations.extract({"is_dir": False, "name": "test.zip", "pickcode": "pick"}, "0", "password", progress.append)
                client.extract_push.assert_called_once_with({"pick_code": "pick", "secret": "password"}, timeout=60)
                self.assertEqual(client.extract_push_progress.call_count, 2)
                self.assertEqual(progress[-1]["percent"], 100)
                mkdir.assert_called_once()

    def test_extraction_invalid_parse_progress_stops_before_creating_folder(self):
        for data in ({}, None, [], {"unzip_status": None}, {"unzip_status": True}, {"unzip_status": 4.5}, {"unzip_status": "invalid"}):
            with self.subTest(data=data):
                operations = FakeOperations()
                client = operations.client
                client.extract_push = Mock(return_value={"state": True, "data": {}})
                response = DiagnosticResponse(state=True, data=data, message="parse reply archive-secret cookie-secret")
                response.request_secrets = ["cookie-secret"]
                client.extract_push_progress = Mock(return_value=response)
                with patch("operations.time.sleep"), patch.object(operations, "mkdir") as mkdir, self.assertRaises(ProviderError) as raised:
                    operations.extract({"is_dir": False, "name": "test.zip", "pickcode": "pick"}, "0", "archive-secret", lambda p: None)
                message = str(raised.exception)
                self.assertIn("GET https://webapi.115.com/files/push_extract", message)
                self.assertIn("data.unzip_status", message)
                self.assertIn("parse reply", message)
                self.assertNotIn("archive-secret", message)
                self.assertNotIn("cookie-secret", message)
                mkdir.assert_not_called()
                self.assertFalse(client.extracted)
                client.extract_push.assert_called_once()
                client.extract_push_progress.assert_called_once()

    def test_extraction_failed_status_reports_stage_and_does_not_continue(self):
        for from_query in (False, True):
            operations = FakeOperations()
            failed = {"state": True, "data": {"unzip_status": 6}, "msg": "wrong password archive-secret"}
            operations.client.extract_push = Mock(return_value={"state": True, "data": {"unzip_status": 1}} if from_query else failed)
            operations.client.extract_push_progress = Mock(return_value=failed)
            with patch("operations.time.sleep"), patch.object(operations, "mkdir") as mkdir, self.assertRaises(ProviderError) as raised:
                operations.extract({"is_dir": False, "name": "test.zip", "pickcode": "pick"}, "0", "archive-secret", lambda p: None)
            self.assertIn(("GET" if from_query else "POST") + " https://webapi.115.com/files/push_extract", str(raised.exception))
            self.assertIn("unzip_status=6", str(raised.exception))
            self.assertIn("wrong password", str(raised.exception))
            self.assertNotIn("archive-secret", str(raised.exception))
            mkdir.assert_not_called()

    def test_extraction_submission_api_failure_is_not_retried(self):
        for state in (False, 0):
            operations = FakeOperations()
            operations.client.extract_push = Mock(return_value={"state": state, "errno": 911, "msg": "denied archive-secret"})
            operations.client.extract_push_progress = Mock()
            with patch.object(operations, "mkdir") as mkdir, self.assertRaises(ProviderError) as raised:
                operations.extract({"is_dir": False, "name": "test.zip", "pickcode": "pick"}, "0", "archive-secret", lambda p: None)
            self.assertIn("POST https://webapi.115.com/files/push_extract", str(raised.exception))
            self.assertIn("911", str(raised.exception))
            self.assertNotIn("archive-secret", str(raised.exception))
            operations.client.extract_push_progress.assert_not_called()
            mkdir.assert_not_called()

    def test_extraction_malformed_submission_is_not_assumed_accepted(self):
        responses = [None, [], {}, {"data": {}}, {"state": True, "data": []},
                     {"state": True, "data": {"unzip_status": None}},
                     {"state": True, "data": {"unzip_status": True}},
                     {"state": True, "data": {"unzip_status": 4.5}}]
        for response in responses:
            with self.subTest(response=response):
                operations = FakeOperations()
                operations.client.extract_push = Mock(return_value=response)
                operations.client.extract_push_progress = Mock()
                with patch.object(operations, "mkdir") as mkdir, self.assertRaises(ProviderError):
                    operations.extract({"is_dir": False, "name": "test.zip", "pickcode": "pick"}, "0", "", lambda p: None)
                operations.client.extract_push_progress.assert_not_called()
                mkdir.assert_not_called()

    def test_extraction_pending_parse_timeout_does_not_create_folder(self):
        operations = FakeOperations()
        operations.client.extract_push = Mock(return_value={"state": True, "data": {"unzip_status": 0}})
        operations.client.extract_push_progress = Mock(return_value={"state": True, "data": {"unzip_status": 1}})
        with patch("operations.time.monotonic", side_effect=[0, 1, 21601]), patch("operations.time.sleep"), patch.object(operations, "mkdir") as mkdir:
            with self.assertRaisesRegex(ProviderError, "等待超时"):
                operations.extract({"is_dir": False, "name": "test.zip", "pickcode": "pick"}, "0", "", lambda p: None)
        operations.client.extract_push.assert_called_once()
        operations.client.extract_push_progress.assert_called_once()
        mkdir.assert_not_called()

    def test_extraction_progress_api_failure_retains_original_error(self):
        operations = FakeOperations()
        operations.client.extract_push = Mock(return_value={"state": True, "data": {}})
        operations.client.extract_push_progress = Mock(return_value={"state": False, "errno": 911, "msg": "verification required"})
        with patch.object(operations, "mkdir") as mkdir, self.assertRaises(ProviderError) as raised:
            operations.extract({"is_dir": False, "name": "test.zip", "pickcode": "pick"}, "0", "", lambda p: None)
        self.assertIn("GET https://webapi.115.com/files/push_extract", str(raised.exception))
        self.assertIn("115 API 911: verification required", str(raised.exception))
        mkdir.assert_not_called()

    def test_extraction_missing_task_id_does_not_resubmit(self):
        for data in ({}, None, {"extract_id": ""}, {"extract_id": None}, {"extract_id": True}):
            with self.subTest(data=data):
                operations = FakeOperations()
                operations.client.extract_file = Mock(return_value={"state": True, "data": data})
                operations.client.extract_progress = Mock()
                with self.assertRaises(ProviderError) as raised:
                    operations.extract({"is_dir": False, "name": "test.zip", "pickcode": "pick"}, "0", "", lambda p: None)
                self.assertIn("POST https://webapi.115.com/files/add_extract_file", str(raised.exception))
                self.assertIn("data.extract_id", str(raised.exception))
                operations.client.extract_file.assert_called_once()
                operations.client.extract_progress.assert_not_called()

    def test_extraction_invalid_percent_never_reports_completion(self):
        for data in ({}, None, {"percent": None}, {"percent": True}, {"percent": "invalid"}, {"percent": "NaN"}, {"percent": "Infinity"}, {"percent": -1}, {"percent": 101}):
            with self.subTest(data=data):
                operations = FakeOperations()
                operations.client.extract_progress = Mock(return_value={"state": True, "data": data})
                progress = []
                with self.assertRaises(ProviderError) as raised:
                    operations.extract({"is_dir": False, "name": "test.zip", "pickcode": "pick"}, "0", "", progress.append)
                self.assertIn("GET https://webapi.115.com/files/add_extract_file", str(raised.exception))
                self.assertIn("data.percent", str(raised.exception))
                self.assertFalse(any(p.get("percent") == 100 for p in progress))
                operations.client.extract_progress.assert_called_once()

    def test_download_cancellation_cleans_temporary_file(self):
        operations = FakeOperations()
        operations.info = lambda _: {"is_dir": False, "name": "test.txt", "pickcode": "p", "size": 4, "sha1": ""}
        operations.client.download_url = lambda *args, **kwargs: "https://example.invalid/test"
        def cancel(progress):
            if progress["bytesDone"]:
                raise Canceled()
        with tempfile.TemporaryDirectory() as root:
            with open_directory(root) as directory, patch("operations.urlopen", return_value=io.BytesIO(b"test")):
                with self.assertRaises(Canceled):
                    operations.download_entry("1", directory, cancel)
            self.assertEqual(os.listdir(root), [])

    def test_download_success_and_no_overwrite(self):
        operations = FakeOperations()
        operations.info = lambda _: {"is_dir": False, "name": "test.txt", "pickcode": "p", "size": 4, "sha1": hashlib.sha1(b"test").hexdigest()}
        operations.client.download_url = lambda *args, **kwargs: "https://example.invalid/test"
        with tempfile.TemporaryDirectory() as root:
            with open_directory(root) as directory, patch("operations.urlopen", return_value=io.BytesIO(b"test")):
                operations.download_entry("1", directory, lambda _: None)
                with self.assertRaises(ProviderError):
                    operations.download_entry("1", directory, lambda _: None)
            self.assertEqual(Path(root, "test.txt").read_bytes(), b"test")
            self.assertEqual(os.listdir(root), ["test.txt"])

    def test_error_does_not_expose_upstream_credentials(self):
        with self.assertRaises(ProviderError) as error:
            AccountContext.checked({"state": False, "errno": 911, "cookie": "secret", "message": "secret"})
        self.assertNotIn("secret", str(error.exception))


if __name__ == "__main__":
    unittest.main()
