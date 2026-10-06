import unittest
from unittest.mock import Mock, patch

from errors import Canceled, DiagnosticResponse, ProviderError
from test_operations import FakeOperations


class DeleteTests(unittest.TestCase):
    def operations(self, replies):
        ops = FakeOperations()
        ops.client.fs_delete = Mock(side_effect=replies)
        ops.info = Mock(side_effect=AssertionError("batch delete must not enumerate entries"))
        ops.invalidate_cloud = Mock()
        return ops

    def test_mixed_selection_is_one_request_with_string_ids(self):
        ops = self.operations([{"state": True}])
        ids = ["1", "9223372036854775808", "3", "1"]
        result = ops.operation("delete", {"ids": ids}, Mock())
        ops.client.fs_delete.assert_called_once_with(ids[:3], timeout=30)
        self.assertEqual(result, {"submitted": True})
        ops.invalidate_cloud.assert_called_once()

    def test_only_explicit_busy_replies_are_retried(self):
        for code in (990009, "990009"):
            ops = self.operations([{"state": False, "errno": code, "error": "删除操作尚未执行完成"}, {"state": True}])
            with patch("operations.time.sleep") as sleep:
                ops.operation("delete", {"ids": ["1", "2"]}, Mock())
            self.assertEqual(ops.client.fs_delete.call_count, 2)
            sleep.assert_called_once_with(2)

    def test_busy_timeout_preserves_original_error(self):
        reply = DiagnosticResponse(state=False, errno=990009, error="删除操作尚未执行完成")
        reply.request_endpoint = "POST https://webapi.115.com/rb/delete"
        ops = self.operations([reply])
        with patch("operations.time.monotonic", side_effect=[0, 60]), self.assertRaisesRegex(ProviderError, "990009") as error:
            ops.operation("delete", {"ids": ["1"]}, Mock())
        self.assertIn("POST https://webapi.115.com/rb/delete", str(error.exception))
        ops.client.fs_delete.assert_called_once()

    def test_retry_is_not_sent_after_wait_budget_expires(self):
        ops = self.operations([{"state": False, "errno": 990009}])
        with patch("operations.time.monotonic", side_effect=[0, 59, 61]), patch("operations.time.sleep") as sleep:
            with self.assertRaisesRegex(ProviderError, "990009"):
                ops.operation("delete", {"ids": ["1"]}, Mock())
        sleep.assert_called_once_with(2)
        ops.client.fs_delete.assert_called_once()

    def test_other_failures_and_uncertain_network_results_are_not_retried(self):
        for reply in (TimeoutError("timed out"), {"state": False, "errno": 911}, {"state": False, "errno": 990005}, {"errno": 990009}, None, {}):
            ops = self.operations([reply])
            with self.subTest(reply=reply), self.assertRaises((ProviderError, TimeoutError)):
                ops.operation("delete", {"ids": ["1"]}, Mock())
            ops.client.fs_delete.assert_called_once()

    def test_cancellation_during_busy_wait_prevents_resubmission(self):
        ops = self.operations([{"state": False, "errno": 990009}])
        report = Mock(side_effect=[None, Canceled()])
        with self.assertRaises(Canceled):
            ops.operation("delete", {"ids": ["1"]}, report)
        ops.client.fs_delete.assert_called_once()

    def test_empty_or_invalid_ids_never_reach_delete(self):
        for ids in ([], ["0"], ["1", "invalid"], ["1,2"], "12"):
            ops = self.operations([])
            with self.subTest(ids=ids), self.assertRaises(ProviderError):
                ops.operation("delete", {"ids": ids}, Mock())
            ops.client.fs_delete.assert_not_called()
