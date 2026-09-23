import sys
import tempfile
import time
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from accounts import Adapter, AccountContext
from errors import ProviderError

class MemoryStorage:
    def __init__(self):
        self.cookies = {}
        self.writes = 0
    def call(self, method, params=None):
        if method == "credential.list": return []
        if method == "credential.get": return self.cookies.get(params["accountId"], "")
        if method == "credential.set":
            self.cookies[params["cookie"].split("UID=")[1].split(";")[0]] = params["cookie"]
            self.writes += 1
        if method == "credential.delete": self.cookies.pop(params["accountId"], None)


class LoginTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.storage = MemoryStorage()
        self.adapter = Adapter(self.storage, self.directory.name)
        self.adapter.sessions["current-session"] = {"qr": {"uid": "private", "time": 1, "sign": "secret"}, "expected": "", "deadline": time.monotonic() + 60, "lock": threading.Lock(), "result": None, "canceled": False}
        self.sdk = Mock()
        self.sdk.side_effect = lambda cookie, **kwargs: Mock(user_id=int(cookie.split("UID=")[1].split(";")[0]))
        self.patch = patch.dict(sys.modules, {"p115client": SimpleNamespace(P115Client=self.sdk)})
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_stale_session_cannot_exchange_credentials(self):
        result = self.adapter.call("login.check", {"loginSession": "old-session"}, None)
        self.assertEqual(result, {"status": -3, "loggedIn": False})
        self.sdk.login_qrcode_scan_status.assert_not_called()
        self.assertFalse(self.storage.cookies)

    def test_confirmation_persists_once_then_invalidates_session(self):
        self.sdk.login_qrcode_scan_status.return_value = {"state": True, "data": {"status": 2}}
        self.sdk.login_qrcode_scan_result.return_value = {"state": True, "data": {"cookie": {"UID": "1", "CID": "private"}}}
        first = self.adapter.call("login.check", {"loginSession": "current-session"}, None)
        self.assertTrue(first["loggedIn"])
        self.assertEqual(self.storage.cookies["1"], "UID=1; CID=private")
        self.assertNotIn("cookie", first)
        second = self.adapter.call("login.check", {"loginSession": "current-session"}, None)
        self.assertEqual(second, first)
        self.assertEqual(self.storage.writes, 1)
        self.sdk.login_qrcode_scan_result.assert_called_once()

    def test_scanned_but_unconfirmed_does_not_login(self):
        self.sdk.login_qrcode_scan_status.return_value = {"state": True, "data": {"status": 1}}
        self.assertEqual(self.adapter.call("login.check", {"loginSession": "current-session"}, None), {"status": 1, "loggedIn": False})
        self.assertFalse(self.storage.cookies)

    def test_database_failure_does_not_report_login_success(self):
        self.sdk.login_qrcode_scan_status.return_value = {"state": True, "data": {"status": 2}}
        self.sdk.login_qrcode_scan_result.return_value = {"state": True, "data": {"cookie": {"UID": "1"}}}
        with patch.object(self.storage, "call", side_effect=ProviderError("database unavailable")), self.assertRaises(ProviderError):
            self.adapter.call("login.check", {"loginSession": "current-session"}, None)
        self.assertIsNone(self.adapter.sessions["current-session"]["result"])

    def test_restart_loads_cookie_and_logout_deletes_it(self):
        self.storage.cookies = {"1": "UID=1; CID=test", "2": "UID=2; CID=other"}
        restarted = Adapter(self.storage, self.directory.name)
        restarted.context("1")
        self.sdk.assert_called_once_with(self.storage.cookies["1"], console_qrcode=False)
        restarted.call("logout", {"accountId": "1"}, None)
        self.assertEqual(self.storage.cookies, {"2": "UID=2; CID=other"})
        self.assertNotIn("1", restarted.contexts)

    def test_expired_session_stops_before_request(self):
        self.adapter.sessions["current-session"]["deadline"] = 0
        self.assertEqual(self.adapter.call("login.check", {"loginSession": "current-session"}, None)["status"], -1)
        self.sdk.login_qrcode_scan_status.assert_not_called()

    def test_parallel_accounts_retain_their_client(self):
        self.storage.cookies = {"1": "UID=1", "2": "UID=2"}
        barrier = threading.Barrier(2)
        results = []
        def operation(context, method, params, progress):
            barrier.wait(timeout=2)
            results.append((params["accountId"], str(context.load().user_id)))
        with patch.object(AccountContext, "operation", operation):
            threads = [threading.Thread(target=self.adapter.call, args=("browse", {"accountId": a, "parentId": "0"}, None)) for a in ("1", "2")]
            for thread in threads: thread.start()
            for thread in threads: thread.join(3)
        self.assertCountEqual(results, [("1", "1"), ("2", "2")])
        with self.assertRaises(ProviderError): self.adapter.context("")
        with self.assertRaises(ProviderError): self.adapter.context("3")

    def test_relogin_keeps_existing_context_and_rejects_wrong_account(self):
        self.storage.cookies["1"] = "UID=1; CID=old"
        old = self.adapter.context("1")
        self.sdk.login_qrcode_scan_status.return_value = {"state": True, "data": {"status": 2}}
        self.sdk.login_qrcode_scan_result.return_value = {"state": True, "data": {"cookie": {"UID": "1", "CID": "new"}}}
        self.adapter.sessions["current-session"]["expected"] = "2"
        with self.assertRaisesRegex(ProviderError, "不匹配"):
            self.adapter.call("login.check", {"loginSession": "current-session"}, None)
        self.assertIs(self.adapter.context("1"), old)
        self.adapter.sessions["current-session"].update(expected="1", canceled=False)
        self.adapter.call("login.check", {"loginSession": "current-session"}, None)
        self.assertIsNot(self.adapter.context("1"), old)
        self.assertEqual(old.cookie, "UID=1; CID=old")

    def test_sessions_independent_and_cancelable(self):
        first = self.adapter.sessions["current-session"]
        self.adapter.sessions["other-session"] = {**first, "lock": threading.Lock()}
        self.adapter.call("login.cancel", {"loginSession": "current-session"}, None)
        self.assertEqual(self.adapter.call("login.check", {"loginSession": "current-session"}, None)["status"], -2)
        self.assertFalse(self.adapter.sessions["other-session"]["canceled"])
        self.sdk.login_qrcode_scan_status.assert_not_called()

    def test_profile_capacity_fields_and_no_cookie_in_response(self):
        self.storage.cookies["1"] = "UID=1"
        context = self.adapter.context("1")
        context.client.user_info2.return_value = {"state": True, "data": {"user_name": "账号", "face": "https://example.com/avatar"}}
        context.client.user_space_info.return_value = {"state": True, "data": {"all_use": {"size": "1024"}, "all_total": {"size": "2048"}}}
        result = context.profile()
        self.assertEqual((result["usedBytes"], result["totalBytes"]), (1024, 2048))
        self.assertEqual(result["avatar"], "https://example.com/avatar")
        self.assertNotIn("cookie", result)

    def test_profile_retains_cached_values_when_provider_is_unavailable(self):
        self.storage.cookies["1"] = "UID=1"
        context = self.adapter.context("1")
        saved = {"accountId": "1", "name": "cached", "avatar": "https://example.com/avatar", "usedBytes": 10, "totalBytes": 20}
        context.client.user_info2.side_effect = TimeoutError()
        context.client.user_space_info.side_effect = TimeoutError()
        with patch.object(self.storage, "call", side_effect=lambda method, params=None: [saved] if method == "credential.list" else None):
            self.assertEqual(context.profile(), saved)
