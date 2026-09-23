import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from worker import Adapter
from errors import ProviderError

class MemoryStorage:
    cookie = ""
    def call(self, method, params=None):
        if method == "credential.get": return self.cookie
        if method == "credential.set": self.cookie = params["cookie"]
        if method == "credential.delete": self.cookie = ""


class LoginTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.storage = MemoryStorage()
        self.adapter = Adapter(self.storage, self.directory.name)
        self.adapter.qr = {"uid": "private", "time": 1, "sign": "secret"}
        self.adapter.qr_session = "current-session"
        self.adapter.qr_deadline = time.monotonic() + 60
        self.sdk = Mock()
        self.patch = patch.dict(sys.modules, {"p115client": SimpleNamespace(P115Client=self.sdk)})
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_stale_session_cannot_exchange_credentials(self):
        result = self.adapter.call("login.check", {"loginSession": "old-session"}, None)
        self.assertEqual(result, {"status": -3, "loggedIn": False})
        self.sdk.login_qrcode_scan_status.assert_not_called()
        self.assertFalse(self.storage.cookie)

    def test_confirmation_persists_once_then_invalidates_session(self):
        self.sdk.login_qrcode_scan_status.return_value = {"state": True, "data": {"status": 2}}
        self.sdk.login_qrcode_scan_result.return_value = {"state": True, "data": {"cookie": {"UID": "1", "CID": "private"}}}
        first = self.adapter.call("login.check", {"loginSession": "current-session"}, None)
        self.assertTrue(first["loggedIn"])
        self.assertEqual(self.storage.cookie, "UID=1; CID=private")
        self.assertNotIn("cookie", first)
        second = self.adapter.call("login.check", {"loginSession": "current-session"}, None)
        self.assertFalse(second["loggedIn"])
        self.sdk.login_qrcode_scan_result.assert_called_once()

    def test_scanned_but_unconfirmed_does_not_login(self):
        self.sdk.login_qrcode_scan_status.return_value = {"state": True, "data": {"status": 1}}
        self.assertEqual(self.adapter.call("login.check", {"loginSession": "current-session"}, None), {"status": 1, "loggedIn": False})
        self.assertFalse(self.storage.cookie)

    def test_database_failure_does_not_report_login_success(self):
        self.sdk.login_qrcode_scan_status.return_value = {"state": True, "data": {"status": 2}}
        self.sdk.login_qrcode_scan_result.return_value = {"state": True, "data": {"cookie": {"UID": "1"}}}
        with patch.object(self.storage, "call", side_effect=ProviderError("database unavailable")), self.assertRaises(ProviderError):
            self.adapter.call("login.check", {"loginSession": "current-session"}, None)
        self.assertEqual(self.adapter.qr_session, "current-session")

    def test_restart_loads_cookie_and_logout_deletes_it(self):
        self.storage.cookie = "UID=1; CID=test"
        restarted = Adapter(self.storage, self.directory.name)
        restarted.load()
        self.sdk.assert_called_once_with(self.storage.cookie, console_qrcode=False)
        restarted.call("logout", {}, None)
        self.assertEqual(self.storage.cookie, "")
        self.assertIsNone(restarted.client)

    def test_expired_session_stops_before_request(self):
        self.adapter.qr_deadline = 0
        self.assertEqual(self.adapter.call("login.check", {"loginSession": "current-session"}, None)["status"], -1)
        self.sdk.login_qrcode_scan_status.assert_not_called()
