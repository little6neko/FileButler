import json
import queue
import threading
import unittest
from unittest.mock import patch

from worker import serve


class Input:
    def __init__(self): self.lines = queue.Queue()
    def readline(self, size): return self.lines.get(timeout=5)
    def send(self, value): self.lines.put(json.dumps(value).encode() + b"\n")


class WorkerConcurrencyTests(unittest.TestCase):
    def test_preview_cancellation_stops_checkpoints_without_progress_messages(self):
        stream, results = Input(), queue.Queue()
        started, release = threading.Event(), threading.Event()
        class Adapter:
            def call(self, method, params, progress):
                if method == "ops.plan":
                    started.set()
                    if not release.wait(3): raise RuntimeError("timed out")
                    progress.checkpoint()
                    raise AssertionError("canceled preview continued")
                return {"ok": True}
        def emit(message):
            if "id" in message: results.put(message)
        with patch("worker.emit", side_effect=emit):
            thread = threading.Thread(target=serve, args=(Adapter(), stream))
            thread.start()
            try:
                stream.send({"id": 1, "method": "ops.plan"})
                self.assertTrue(started.wait(2))
                stream.send({"cancelId": 1})
                stream.send({"id": 2, "method": "browse"})
                self.assertEqual(results.get(timeout=2), {"id": 2, "data": {"ok": True}})
                release.set()
                self.assertTrue(results.get(timeout=2)["canceled"])
            finally:
                release.set()
                stream.lines.put(b"")
                thread.join(timeout=3)
            self.assertFalse(thread.is_alive())

    def test_details_cancel_message_releases_pending_progress(self):
        stream, results = Input(), queue.Queue()
        class Adapter:
            def call(self, method, params, progress):
                progress({"phase": "details", "file": "", "cancelable": True, "bytesDone": 0, "bytesTotal": 0})
                raise AssertionError("canceled details continued")
        def emit(message):
            if "progress" in message:
                stream.send({"cancelId": message["id"]})
            elif "id" in message:
                results.put(message)
        with patch("worker.emit", side_effect=emit):
            thread = threading.Thread(target=serve, args=(Adapter(), stream))
            thread.start()
            try:
                stream.send({"id": 1, "method": "details.stats", "params": {}})
                self.assertTrue(results.get(timeout=2)["canceled"])
            finally:
                stream.lines.put(b"")
                thread.join(timeout=3)
            self.assertFalse(thread.is_alive())

    def test_all_requests_start_and_cancel_only_their_own_progress(self):
        stream = Input()
        started, results = queue.Queue(), queue.Queue()
        release = threading.Event()

        class Adapter:
            def call(self, method, params, progress):
                started.put(params["number"])
                if not release.wait(5): raise RuntimeError("timed out")
                progress({"phase": "copy", "file": str(params["number"]), "cancelable": True, "bytesDone": 1, "bytesTotal": 1})
                return params

        def emit(message):
            if "progress" in message:
                stream.send({"id": message["id"], "ack": True, "cancel": message["id"] == 2})
            elif "id" in message:
                results.put(message)

        with patch("worker.emit", side_effect=emit):
            thread = threading.Thread(target=serve, args=(Adapter(), stream))
            thread.start()
            try:
                for number in range(8): stream.send({"id": number, "method": "download", "params": {"number": number}})
                self.assertEqual({started.get(timeout=2) for _ in range(8)}, set(range(8)))
                release.set()
                replies = {reply["id"]: reply for reply in [results.get(timeout=2) for _ in range(8)]}
                self.assertTrue(replies[2]["canceled"])
                for number in set(range(8)) - {2}: self.assertEqual(replies[number]["data"], {"number": number})
            finally:
                release.set()
                stream.lines.put(b"")
                thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
