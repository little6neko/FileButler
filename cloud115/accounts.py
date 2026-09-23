"""Account registry. Operations retain one immutable client context per request."""
import base64
import io
import re
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from errors import ProviderError, install_request_diagnostics, response_error
from operations import CloudOperations


def checked(result):
    if not isinstance(result, dict) or result.get("state") is False:
        raise ProviderError(response_error(result) if isinstance(result, dict) else "115接口返回了非对象响应")
    return result


class AccountContext(CloudOperations):
    checked = staticmethod(checked)

    def __init__(self, storage, data_dir, account, cookie):
        from p115client import P115Client
        self.storage = storage
        self.data_dir = Path(data_dir)
        self.account = account
        self.cookie = cookie
        self.lock = threading.RLock()
        self.client = P115Client(cookie, console_qrcode=False)
        install_request_diagnostics(self.client, cookie)
        if str(self.client.user_id) != account:
            raise ProviderError("115登录凭证与账号不匹配")

    def load(self):
        return self.client

    def profile(self):
        result = {"accountId": self.account, "name": self.account, "avatar": "", "usedBytes": None, "totalBytes": None}
        for saved in self.storage.call("credential.list"):
            if saved["accountId"] == self.account:
                result.update({key: saved[key] for key in ("name", "avatar", "usedBytes", "totalBytes")})
                break
        result["name"] = result["name"] or self.account
        # Optional display information never prevents file access.
        try:
            data = checked(self.client.user_info2(timeout=10)).get("data", {})
            name = data.get("user_name") or data.get("user_nick_name") or data.get("nick_name")
            if isinstance(name, str) and name.strip(): result["name"] = name[:200]
            avatar = data.get("face") or data.get("user_face") or data.get("avatar")
            if isinstance(avatar, str) and urlsplit(avatar).scheme in ("http", "https"):
                result["avatar"] = avatar
        except Exception:
            pass
        try:
            data = checked(self.client.user_space_info(timeout=10)).get("data", {})
            for source, target in (("all_use", "usedBytes"), ("all_total", "totalBytes")):
                value = data.get(source)
                if isinstance(value, dict): value = value.get("size")
                if value is not None and int(value) >= 0: result[target] = int(value)
        except Exception:
            pass
        self.storage.call("credential.profile", {**result, "cookie": self.cookie})
        return result


class Adapter:
    def __init__(self, storage, data_dir):
        self.storage = storage
        self.data_dir = data_dir
        self.contexts = {}
        self.sessions = {}
        self.epochs = {}
        self.lock = threading.RLock()

    def context(self, account):
        if not isinstance(account, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", account):
            raise ProviderError("请选择115账号")
        with self.lock:
            cookie = self.storage.call("credential.get", {"accountId": account})
            if not cookie: raise ProviderError("115账号不存在，请重新添加")
            current = self.contexts.get(account)
            if current is None or current.cookie != cookie:
                current = AccountContext(self.storage, self.data_dir, account, cookie)
                self.contexts[account] = current
            return current

    def call(self, method, params, progress):
        from p115client import P115Client
        if method == "accounts": return self.storage.call("credential.list")
        if method == "login.start":
            expected = params.get("accountId", "")
            if expected: self.context(expected)
            qr = checked(P115Client.login_qrcode_token(app="alipaymini", timeout=30))["data"]
            import qrcode
            from qrcode.image.svg import SvgPathImage
            image = qrcode.make(qr["qrcode"], image_factory=SvgPathImage)
            data = io.BytesIO(); image.save(data)
            session = secrets.token_urlsafe(24)
            with self.lock:
                now = time.monotonic()
                self.sessions = {key: value for key, value in self.sessions.items() if value["deadline"] > now}
                if len(self.sessions) >= 64: raise ProviderError("登录会话过多，请稍后重试")
                self.sessions[session] = {"qr": qr, "expected": expected, "deadline": now + 300, "lock": threading.Lock(), "result": None, "canceled": False, "epochs": dict(self.epochs)}
            return {"image": "data:image/svg+xml;base64," + base64.b64encode(data.getvalue()).decode(), "loginSession": session}
        if method in ("login.check", "login.cancel"):
            with self.lock: session = self.sessions.get(params.get("loginSession"))
            if session is None: return {"status": -3, "loggedIn": False}
            with session["lock"]:
                if method == "login.cancel":
                    session["canceled"] = True
                    return {"status": -2, "loggedIn": False}
                if session["canceled"]: return {"status": -2, "loggedIn": False}
                if time.monotonic() >= session["deadline"]: return {"status": -1, "loggedIn": False}
                if session["result"]: return session["result"]
                qr = session["qr"]
                status = int(checked(P115Client.login_qrcode_scan_status({key: qr[key] for key in ("uid", "time", "sign")}, timeout=30))["data"]["status"])
                if status != 2:
                    if status < 0: session["canceled"] = True
                    return {"status": status, "loggedIn": False}
                cookies = checked(P115Client.login_qrcode_scan_result(qr["uid"], app="alipaymini", timeout=30))["data"]["cookie"]
                cookie = "; ".join(f"{key}={value}" for key, value in cookies.items())
                account = str(cookies.get("UID", "")).split("_", 1)[0]
                if session["expected"] and account != session["expected"]:
                    session["canceled"] = True
                    raise ProviderError("扫码账号不匹配，请使用原账号重新登录")
                context = AccountContext(self.storage, self.data_dir, account, cookie)
                if not context.load().login_status(timeout=15): raise ProviderError("115登录凭证无效，请重新扫码")
                with self.lock:
                    if session["canceled"] or session.get("epochs", {}).get(account, 0) != self.epochs.get(account, 0):
                        raise ProviderError("登录会话已取消，请重新扫码")
                    self.storage.call("credential.set", {"cookie": cookie})
                    self.contexts[account] = context
                session["result"] = {"status": 2, "loggedIn": True, "accountId": account}
                return session["result"]
        account = params.get("accountId")
        if method == "logout":
            with self.lock:
                self.context(account)
                self.storage.call("credential.delete", {"accountId": account})
                self.epochs[account] = self.epochs.get(account, 0) + 1
                self.contexts.pop(account, None)
                # Completed login sessions must not resurrect a removed account.
                for session in self.sessions.values():
                    if session["expected"] == account or (session["result"] or {}).get("accountId") == account:
                        session["canceled"] = True
            return {"loggedIn": False, "accountId": account}
        context = self.context(account)
        if method == "status": return {"loggedIn": bool(context.load().login_status(timeout=15)), "accountId": account}
        if method == "profile": return context.profile()
        return context.operation(method, params, progress)
