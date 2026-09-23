import json
import sys

print(json.dumps({"ready": 1}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    if request["method"] == "crash":
        sys.exit(1)
    if request["method"] == "progress":
        print(json.dumps({"id": request["id"], "progress": {"phase": "hash", "file": "a", "bytesTotal": 100, "bytesDone": 50, "cancelable": True}}), flush=True)
        ack = json.loads(sys.stdin.readline())
        if ack["cancel"]:
            print(json.dumps({"id": request["id"], "canceled": True}), flush=True)
            continue
    print(json.dumps({"id": request["id"], "data": {"ok": True}}), flush=True)
