import json
import sys

print(json.dumps({"ready": 1}), flush=True)
canceled_plans = 0
for line in sys.stdin:
    request = json.loads(line)
    if "cancelId" in request:
        canceled_plans += 1
        print(json.dumps({"id": request["cancelId"], "canceled": True}), flush=True)
        continue
    if request.get("ack"):
        continue
    if request["method"] == "offline.add":
        rejected = request["params"]["url"].endswith("/rejected")
        message = {"id": request["id"], "error": "POST https://clouddownload.115.com/web/\n115 API unknown: 任务已存在，请勿输入重复的链接地址"}
        if rejected:
            message["errorKind"] = "api_rejection"
        print(json.dumps(message), flush=True)
        continue
    if request["method"] in ("ops.plan", "transfer.statistics"):
        print(json.dumps({"id": request["id"], "progress": {"phase": "scan", "file": "", "bytesTotal": 0, "bytesDone": 0, "cancelable": True}}), flush=True)
        continue
    if request["method"] == "canceled-plans":
        print(json.dumps({"id": request["id"], "data": canceled_plans}), flush=True)
        continue
    if request["method"] == "crash":
        sys.exit(1)
    if request["method"] == "progress":
        print(json.dumps({"id": request["id"], "progress": {"phase": "hash", "file": "a", "bytesTotal": 100, "bytesDone": 50, "cancelable": True}}), flush=True)
        ack = json.loads(sys.stdin.readline())
        if ack["cancel"]:
            print(json.dumps({"id": request["id"], "canceled": True}), flush=True)
            continue
    print(json.dumps({"id": request["id"], "data": {"ok": True}}), flush=True)
