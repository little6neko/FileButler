import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from worker import Adapter


class LoginTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.adapter = Adapter(str(Path(self.directory.name) / "cookies"))
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
        self.assertFalse(self.adapter.credentials.exists())

    def test_confirmation_persists_once_then_invalidates_session(self):
        self.sdk.login_qrcode_scan_status.return_value = {"state": True, "data": {"status": 2}}
        self.sdk.login_qrcode_scan_result.return_value = {"state": True, "data": {"cookie": {"UID": "1", "CID": "private"}}}
        first = self.adapter.call("login.check", {"loginSession": "current-session"}, None)
        self.assertTrue(first["loggedIn"])
        self.assertEqual(self.adapter.credentials.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("cookie", first)
        second = self.adapter.call("login.check", {"loginSession": "current-session"}, None)
        self.assertFalse(second["loggedIn"])
        self.sdk.login_qrcode_scan_result.assert_called_once()

    def test_scanned_but_unconfirmed_does_not_login(self):
        self.sdk.login_qrcode_scan_status.return_value = {"state": True, "data": {"status": 1}}
        self.assertEqual(self.adapter.call("login.check", {"loginSession": "current-session"}, None), {"status": 1, "loggedIn": False})
        self.assertFalse(self.adapter.credentials.exists())

    def test_expired_session_stops_before_request(self):
        self.adapter.qr_deadline = 0
        self.assertEqual(self.adapter.call("login.check", {"loginSession": "current-session"}, None)["status"], -1)
        self.sdk.login_qrcode_scan_status.assert_not_called()
