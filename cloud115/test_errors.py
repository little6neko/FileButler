import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.error import HTTPError

from errors import ProviderError, describe_error, install_request_diagnostics, response_error
from accounts import checked


class DiagnosticTests(unittest.TestCase):
    def test_http_error_includes_endpoint_and_status_without_credentials(self):
        url = "https://user:password@webapi.115.com/files/get_info?token=private#secret"
        client = SimpleNamespace(request=Mock(side_effect=HTTPError(url, 405, "Method Not Allowed", {"Set-Cookie": "private"}, None)))
        install_request_diagnostics(client, "UID=account; SEID=private")
        with self.assertRaises(HTTPError) as raised:
            client.request(url=url)
        self.assertEqual(describe_error(raised.exception), "GET https://webapi.115.com/files/get_info\nHTTP 405 Method Not Allowed")

    def test_api_failure_preserves_message_but_redacts_echoed_secrets(self):
        client = SimpleNamespace(request=Mock(return_value={"state": False, "errno": 911, "message": "验证失败 private"}))
        install_request_diagnostics(client, "UID=account; SEID=private")
        with self.assertRaises(ProviderError) as raised:
            checked(client.request("https://webapi.115.com/files", method="POST"))
        self.assertEqual(str(raised.exception), "POST https://webapi.115.com/files\n115 API 911: 验证失败 [redacted]")

    def test_unknown_exception_preserves_type_and_safe_message(self):
        self.assertEqual(describe_error(ValueError("invalid response")), "ValueError: invalid response")
        self.assertNotIn("private", describe_error(RuntimeError("headers={'Cookie': 'private'}")))

    def test_response_credentials_are_not_echoed(self):
        self.assertNotIn("private", response_error({"cookie": "private", "message": "private", "errno": 911}))

    def test_success_and_request_arguments_are_unchanged(self):
        original = Mock(return_value={"state": True, "data": []})
        client = SimpleNamespace(request=original)
        install_request_diagnostics(client, "UID=account")
        self.assertEqual(client.request("https://webapi.115.com/files", params={"cid": "9"}, timeout=30), {"state": True, "data": []})
        original.assert_called_once_with(url="https://webapi.115.com/files", method="GET", params={"cid": "9"}, timeout=30)
