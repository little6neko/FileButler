import queue
import threading
import unittest
from private_storage import PrivateStorage
from errors import ProviderError

class PrivateStorageTests(unittest.TestCase):
    def test_out_of_order_replies_and_disconnect(self):
        requests = queue.Queue(); results = queue.Queue()
        storage = PrivateStorage(requests.put)
        def call(value): results.put((value, storage.call("test", {"value": value})))
        threads = [threading.Thread(target=call, args=(i,)) for i in range(8)]
        for thread in threads: thread.start()
        messages = [requests.get(timeout=2) for _ in threads]
        for message in reversed(messages): storage.receive({"storageReply": message["storageId"], "data": message["params"]["value"]})
        for thread in threads: thread.join(2)
        self.assertEqual({results.get(timeout=2) for _ in threads}, {(i, i) for i in range(8)})
        def disconnected():
            try: storage.call("credential.get")
            except ProviderError: results.put("closed")
        thread = threading.Thread(target=disconnected); thread.start(); requests.get(timeout=2); storage.close(); thread.join(2)
        self.assertEqual(results.get(timeout=2), "closed")
        with self.assertRaises(ProviderError): storage.call("credential.get")
