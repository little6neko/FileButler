import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "cloud115"))
from worker import serve, emit
from private_storage import PrivateStorage

storage = PrivateStorage(emit)
class Adapter:
    def call(self, method, params, report):
        return {"ok": storage.call("credential.get", {"accountId": "7"}) == "UID=7; CID=test"}
serve(Adapter(), sys.stdin.buffer, storage)
