"""Read-only details; hashes are retrieved from cache unless explicitly refreshed."""
import json
import re
from errors import ProviderError


class FileDetails:
    def details(self, method, params, report):
        from p115client.tool.attr import get_attr, get_path
        account = params["accountId"]
        def guard():
            if str(self.load().user_id) != account:
                raise ProviderError("115账号已变化，请重新打开详细信息")
        def checkpoint():
            guard()
            report({"phase": "details", "file": "", "bytesDone": 0, "bytesTotal": 0, "cancelable": True})
        def info(file_id):
            checkpoint()
            with self.lock:
                guard()
                if file_id == "0":
                    return {"id": "0", "parent_id": "0", "name": "115网盘", "is_dir": True, "size": 0}
                return get_attr(self.load(), int(file_id), ensure_parent_id=True, timeout=10)
        ids = params["ids"]
        checkpoint()
        if method == "details.url":
            with self.lock:
                guard()
                return self.operation("preview.url", {"id": ids[0], "userAgent": params.get("userAgent", "")}, report)
        items = [info(file_id) for file_id in ids]
        if method == "details.stats":
            seen, size, files, folders = set(), 0, 0, 0
            stack = [(str(item["id"]), bool(item["is_dir"]), int(item.get("size") or 0)) for item in items]
            while stack:
                checkpoint()
                file_id, directory, length = stack.pop()
                if file_id in seen:
                    continue
                seen.add(file_id)
                if not directory:
                    files += 1
                    size += length
                    continue
                folders += 1
                offset, expected, page_seen = 0, None, set()
                while True:
                    checkpoint()
                    with self.lock:
                        guard()
                        page = self.browse(file_id, offset)
                    if expected is not None and expected != page["total"]:
                        raise ProviderError("目录在统计时发生变化，请重新打开详细信息")
                    expected = page["total"]
                    for entry in page["entries"]:
                        if entry["id"] in page_seen:
                            raise ProviderError("目录在统计时发生变化，请重新打开详细信息")
                        page_seen.add(entry["id"])
                    stack.extend((entry["id"], entry["isDirectory"], entry["size"]) for entry in page["entries"])
                    offset += len(page["entries"])
                    if offset >= expected:
                        break
                    if not page["entries"]:
                        raise ProviderError("目录统计未完成")
            if len(items) == 1 and items[0]["is_dir"]:
                folders -= 1
            return {"size": size, "allocated": None, "files": files, "folders": folders}
        if method == "details.hash":
            item = items[0]
            if len(items) != 1 or item["is_dir"]:
                raise ProviderError("请选择一个文件")
            digest = str(item.get("sha1") or "").upper()
            if not re.fullmatch(r"[0-9A-F]{40}", digest):
                self.storage.call("hash.invalidate", {"account": account, "fileId": str(item["id"])})
                return {"sha1": ""}
            try:
                self.storage.call("hash.put", self.details_hash_params(account, item, digest))
                return {"sha1": digest}
            except Exception:
                return {"sha1": digest, "warning": "SHA1已获取，但缓存保存失败"}
        out = []
        for item in items:
            checkpoint()
            with self.lock:
                guard()
                location = get_path(self.load(), int(item.get("parent_id") or 0), timeout=10) or "/"
            digest, warning = "", ""
            if len(items) == 1 and not item["is_dir"]:
                try:
                    digest = self.storage.call("hash.get", self.details_hash_params(account, item, str(item.get("sha1") or "").upper())) or ""
                except Exception:
                    warning = "SHA1缓存暂时无法读取"
            out.append({"name": item["name"], "type": "directory" if item["is_dir"] else "file", "path": str(item["id"]), "location": location, "size": int(item.get("size") or 0), "allocated": None, "modifiedUnix": item.get("mtime") or None, "createdUnix": item.get("ctime") or None, "sha1": digest})
            if warning:
                out[-1]["warning"] = warning
        guard()
        return out

    @staticmethod
    def details_hash_params(account, item, digest):
        return {"account": account, "fileId": str(item["id"]), "version": json.dumps([int(item.get("size") or 0), int(item.get("mtime") or 0), digest], separators=(", ", ": ")), "sha1": digest, "origin": "115"}
