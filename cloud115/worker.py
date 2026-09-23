"""Private JSON-lines provider. stdout is reserved exclusively for protocol messages."""
import argparse
import concurrent.futures
import contextlib
import io
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time
from errors import Canceled, ProviderError
from operations import CloudOperations

PROTOCOL_OUTPUT = sys.stdout
output_lock = threading.Lock()


def emit(message):
    with output_lock:
        PROTOCOL_OUTPUT.write(json.dumps(message, ensure_ascii=False) + "\n")
        PROTOCOL_OUTPUT.flush()


class Adapter(CloudOperations):
    def __init__(self, credentials):
        self.credentials = Path(credentials)
        self.client = None
        self.qr = None
        self.lock = threading.RLock()

    def load(self):
        from p115client import P115Client
        if self.client is None:
            if not self.credentials.is_file():
                raise ProviderError("请先登录115网盘")
            cookies = self.credentials.read_text().strip()
            if not cookies or "UID=" not in cookies:
                raise ProviderError("115登录凭证无效，请清除后重新扫码")
            self.client = P115Client(cookies, console_qrcode=False)
        return self.client

    @staticmethod
    def checked(result):
        if not isinstance(result, dict) or result.get("state") is False:
            # Never expose arbitrary upstream response bodies (may contain credentials).
            code = result.get("errno", result.get("errNo", "unknown")) if isinstance(result, dict) else "invalid"
            raise ProviderError(f"115接口失败（代码 {code}），请检查登录状态、权限或操作限制")
        return result

    def call(self, method, params, progress):
        from p115client import P115Client
        with self.lock:
            if method == "status":
                if not self.credentials.is_file():
                    return {"loggedIn": False}
                client = self.load()
                return {"loggedIn": bool(client.login_status(timeout=30))}
            if method == "login.start":
                if self.credentials.is_file():
                    raise ProviderError("请先退出当前115账号")
                self.qr = self.checked(P115Client.login_qrcode_token(app="alipaymini", timeout=30))["data"]
                import qrcode
                from qrcode.image.svg import SvgPathImage
                image = qrcode.make(self.qr["qrcode"], image_factory=SvgPathImage)
                data = io.BytesIO()
                image.save(data)
                import base64
                return {"image": "data:image/svg+xml;base64," + base64.b64encode(data.getvalue()).decode()}
            if method == "login.check":
                if not self.qr:
                    raise ProviderError("二维码已失效，请重新获取")
                result = self.checked(P115Client.login_qrcode_scan_status({key: self.qr[key] for key in ("uid", "time", "sign")}, timeout=30))
                status = int(result["data"]["status"])
                if status == 2:
                    result = self.checked(P115Client.login_qrcode_scan_result(self.qr["uid"], app="alipaymini", timeout=30))
                    cookies = result["data"]["cookie"]
                    self.credentials.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    import tempfile
                    fd, name = tempfile.mkstemp(dir=self.credentials.parent)
                    try:
                        with os.fdopen(fd, "w") as file:
                            file.write("; ".join(f"{key}={value}" for key, value in cookies.items()))
                        os.replace(name, self.credentials)
                    finally:
                        if os.path.exists(name):
                            os.unlink(name)
                    self.client = None
                    self.qr = None
                return {"status": status, "loggedIn": status == 2}
            if method == "logout":
                self.client = None
                self.qr = None
                self.credentials.unlink(missing_ok=True)
                return {"loggedIn": False}
        return self.operation(method, params, progress)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--credentials", required=True)
    args = parser.parse_args()
    adapter = Adapter(args.credentials)
    acknowledgements = {}
    emit({"ready": 1})
    # Dependencies sometimes print. Keep such output away from JSON and logs.
    sys.stdout = open(os.devnull, "w")

    def execute(message, ack):
        task_id = message["id"]
        last_key = None
        last_at = 0.0

        def progress(value):
            nonlocal last_key, last_at
            key = (value["phase"], value["file"], value["cancelable"])
            now = time.monotonic()
            complete = value.get("bytesTotal", 0) > 0 and value["bytesDone"] == value["bytesTotal"] or value.get("percent") == 100
            if key == last_key and now - last_at < 0.1 and not complete:
                return
            last_key, last_at = key, now
            emit({"id": task_id, "progress": value})
            if ack.get(timeout=60):
                raise Canceled()

        try:
            result = adapter.call(message["method"], message.get("params") or {}, progress)
            emit({"id": task_id, "data": result})
        except Canceled:
            emit({"id": task_id, "canceled": True})
        except ProviderError as error:
            emit({"id": task_id, "error": str(error)})
        except ImportError:
            emit({"id": task_id, "error": "115依赖不可用，请安装Python 3.12+及cloud115/requirements.txt"})
        except FileExistsError:
            emit({"id": task_id, "error": "目标文件或目录已存在（未覆盖）"})
        except FileNotFoundError:
            emit({"id": task_id, "error": "源文件或目标目录已不存在，请刷新后重试"})
        except Exception:
            emit({"id": task_id, "error": "115请求失败，请检查网络、登录状态及依赖版本；写入结果不确定时请刷新后确认"})
        finally:
            acknowledgements.pop(task_id, None)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        while True:
            line = sys.stdin.buffer.readline(1024*1024 + 1)
            if not line:
                break
            if len(line) > 1024*1024:
                break
            message = json.loads(line)
            if message.get("ack"):
                ack = acknowledgements.get(message["id"])
                if ack is not None:
                    ack.put(bool(message.get("cancel")))
            else:
                ack = queue.Queue(maxsize=1)
                acknowledgements[message["id"]] = ack
                pool.submit(execute, message, ack)
        for ack in list(acknowledgements.values()):
            with contextlib.suppress(queue.Full):
                ack.put_nowait(True)


if __name__ == "__main__":
    main()
