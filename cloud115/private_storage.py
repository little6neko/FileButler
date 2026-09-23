"""Correlated private RPC; never expose storage operations over HTTP."""
import queue
import threading
from errors import ProviderError

class PrivateStorage:
    def __init__(self, emit):
        self.emit = emit
        self.lock = threading.Lock()
        self.next_id = 0
        self.pending = {}
        self.closed = False

    def call(self, method, params=None):
        with self.lock:
            if self.closed: raise ProviderError("后端存储连接已关闭")
            self.next_id += 1
            request_id = self.next_id
            reply = queue.Queue(maxsize=1)
            self.pending[request_id] = reply
        try:
            self.emit({"storageId": request_id, "storageMethod": method, "params": params or {}})
            try: result = reply.get(timeout=15)
            except queue.Empty: raise ProviderError("后端存储请求超时") from None
            if result.get("error"): raise ProviderError("后端存储操作失败")
            return result.get("data")
        finally:
            with self.lock: self.pending.pop(request_id, None)

    def receive(self, message):
        with self.lock:
            reply = self.pending.get(message["storageReply"])
            if reply is not None:
                try: reply.put_nowait(message)
                except queue.Full: pass

    def close(self):
        with self.lock:
            self.closed = True
            for reply in self.pending.values():
                try: reply.put_nowait({"error": True})
                except queue.Full: pass
