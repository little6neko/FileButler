"""115 operations; no HTTP server, browser state, or local authentication here."""
import hashlib
import os
import stat
import time
import uuid
from contextlib import contextmanager
from urllib.request import Request, urlopen
from urllib.parse import urlsplit, parse_qs

from errors import Canceled, ProviderError
from batch import BatchOperations
from file_operations import SharedFileOperations
from hash_cache import HashCache
from details import FileDetails


def safe_name(name):
    if not isinstance(name, str) or not name or name in (".", "..") or any(c in name for c in "/\\\x00"):
        raise ProviderError("文件名无效或包含路径分隔符")
    return name


@contextmanager
def open_directory(path):
    # Walk from filesystem root using no-follow descriptors: path replacement
    # cannot redirect a transfer outside the directory validated by Go.
    if os.name != "posix":
        raise ProviderError("115本地传输当前需要Linux/macOS或Docker环境")
    if not os.path.isabs(path):
        raise ProviderError("本地路径必须为绝对路径")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.split("/"):
            if not part:
                continue
            safe_name(part)
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        yield fd
    finally:
        os.close(fd)


def progress_value(phase, name, done=0, total=0, cancelable=True, percent=None):
    value = {"phase": phase, "file": name, "bytesDone": done, "bytesTotal": total, "cancelable": cancelable}
    if percent is not None:
        value["percent"] = percent
    return value


class CloudOperations(BatchOperations, SharedFileOperations, HashCache, FileDetails):
    def info(self, file_id):
        from p115client.tool.attr import get_attr
        item = get_attr(self.load(), int(file_id), timeout=30)
        self.cloud_hash(item)
        return item

    def browse(self, parent, offset=0, checkpoint=lambda: None):
        from p115client.tool.attr import normalize_attr_web
        checkpoint()
        if str(parent) != "0" and not self.info(parent)["is_dir"]:
            raise ProviderError("目标不是文件夹")
        checkpoint()
        result = self.checked(self.load().fs_files({"cid": parent, "offset": offset, "limit": 200, "show_dir": 1, "cur": 1, "o": "file_name", "asc": 1}, timeout=30))
        if str(result.get("cid", parent)) != str(parent):
            raise ProviderError("115目录已不存在，请刷新")
        entries = []
        for raw in result["data"]:
            item = normalize_attr_web(raw)
            self.cloud_hash(item)
            entries.append({"id": str(item["id"]), "parentId": str(item["parent_id"]), "name": item["name"], "isDirectory": item["is_dir"], "size": item["size"], "modifiedUnix": int(item.get("mtime") or 0)})
        return {"entries": entries, "total": int(result["count"]), "offset": offset}

    def children(self, parent, checkpoint=lambda: None):
        offset = 0
        expected_total = None
        seen = set()
        while True:
            checkpoint()
            page = self.browse(parent, offset, checkpoint=checkpoint)
            checkpoint()
            if expected_total is not None and page["total"] != expected_total:
                raise ProviderError("目录在读取时发生变化，请重新加载")
            expected_total = page["total"]
            for entry in page["entries"]:
                if entry["id"] in seen:
                    raise ProviderError("目录在读取时发生变化，请重新加载")
                seen.add(entry["id"])
            yield from page["entries"]
            offset += len(page["entries"])
            if offset >= page["total"]:
                break
            if not page["entries"]:
                raise ProviderError("115返回不完整的目录列表")

    def ensure_unused(self, parent, name, except_id=None):
        safe_name(name)
        if any(item["name"] == name and item["id"] != str(except_id) for item in self.children(parent)):
            raise ProviderError(f"目标已存在：{name}（未覆盖）")

    def mkdir(self, parent, name):
        self.ensure_unused(parent, name)
        result = self.checked(self.load().fs_mkdir(name, pid=parent, timeout=30))
        return str(result.get("cid") or result.get("data", {}).get("cid") or self.find_child(parent, name)["id"])

    def find_child(self, parent, name):
        for item in self.children(parent):
            if item["name"] == name:
                return item
        raise ProviderError("115未确认目标文件，请刷新后核实，不要重复提交")

    def operation(self, method, params, report):
        client = self.load()
        if method.startswith("details."):
            return self.details(method, params, report)
        parent = params.get("parentId", "0")
        dest = params.get("destId", "0")
        if method == "ops.plan":
            return self.operation_plan(params, checkpoint=getattr(report, "checkpoint", lambda: None))
        if method == "ops.execute":
            return self.operation_execute(params, report)
        if method == "batch.scan":
            return self.batch_scan(params)
        if method == "account":
            return {"accountId": str(client.user_id)}
        if method == "batch.execute":
            return self.batch_execute(params, report)
        if method == "browse":
            return self.browse(parent, params.get("offset", 0))
        if method == "preview.url":
            item = self.info(params["id"])
            if item["is_dir"]:
                raise ProviderError("目录不能作为文件预览")
            url = client.download_url(item["pickcode"], user_agent=params.get("userAgent", ""), app="android", timeout=30)
            parsed = urlsplit(str(url))
            if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
                raise ProviderError("115返回了无效直链")
            headers = {key.lower(): value for key, value in getattr(url, "headers", {}).items()}
            flags = parse_qs(parsed.query).get("f", [""])[0]
            if "cookie" in headers or "authorization" in headers or flags not in ("", "0", "1"):
                raise ProviderError("该直链需要额外认证，浏览器无法安全直连；不会通过FB中转")
            if any(key not in ("user-agent", "accept", "accept-encoding", "connection") for key in headers):
                raise ProviderError("该直链要求额外请求头，浏览器无法直接预览")
            # Never serialize SDK headers or account credentials.
            return {"url": str(url), "name": item["name"], "size": int(item.get("size") or 0), "accountId": str(client.user_id)}
        if method == "resolve":
            trail = [{"id": "0", "name": "115网盘"}]
            for part in params.get("path", "").replace("\\", "/").split("/"):
                if part in ("", "."):
                    continue
                if part == "..":
                    if len(trail) > 1:
                        trail.pop()
                    continue
                matches = [entry for entry in self.children(trail[-1]["id"]) if entry["isDirectory"] and entry["name"] == part]
                if len(matches) != 1:
                    raise ProviderError("目录不存在或存在同名目录，请通过目录列表逐级打开")
                trail.append({"id": matches[0]["id"], "name": part})
            return {"trail": trail}
        if method == "offline.add":
            if str(dest) != "0" and not self.info(dest)["is_dir"]:
                raise ProviderError("目标不是文件夹")
            self.checked(client.clouddownload_task_add_url({"url": params["url"], "wp_path_id": dest}, timeout=30))
            return {"submitted": True}
        report(progress_value("scan", params.get("name", "")))
        if method == "upload":
            path = params["localPath"]
            with open_directory(os.path.dirname(path)) as directory:
                self.upload_entry(directory, os.path.basename(path), dest, report, path)
            return {"ok": True}
        if method == "download":
            with open_directory(params["localPath"]) as directory:
                self.download_entry(params["id"], directory, report, params["localPath"])
            return {"ok": True}
        if method == "mkdir":
            report(progress_value("waiting", params["name"], cancelable=False))
            return {"id": self.mkdir(parent, params["name"])}
        item = self.info(params["id"])
        name = item["name"]
        if method == "extract":
            self.extract(item, dest, params.get("password", ""), report)
            return {"ok": True}
        report(progress_value("waiting", name, cancelable=False))
        if method == "rename":
            self.ensure_unused(item["parent_id"], params["name"], item["id"])
            self.checked(client.fs_rename((item["id"], params["name"]), timeout=30))
            if self.info(item["id"])["name"] != params["name"]:
                raise ProviderError("115未确认新名称，请刷新后核实")
        elif method in ("copy", "move"):
            self.ensure_unused(dest, name)
            if item["is_dir"]:
                ancestor = str(dest)
                seen = set()
                while ancestor != "0":
                    if ancestor == str(item["id"]) or ancestor in seen:
                        raise ProviderError("不能复制或移动文件夹到自身或其子目录")
                    seen.add(ancestor)
                    ancestor = str(self.info(ancestor)["parent_id"])
            if method == "copy" and item["is_dir"]:
                # Copy directories one leaf at a time so a populated root is not
                # mistaken for completion of an asynchronous server-side tree copy.
                self.copy_directory(item, dest, report)
                return {"ok": True}
            self.checked(getattr(client, "fs_" + method)(item["id"], pid=dest, timeout=30))
            self.find_child(dest, name)
            if method == "move" and str(self.info(item["id"])["parent_id"]) != str(dest):
                raise ProviderError("115尚未确认移动完成，请刷新后核实")
        elif method == "delete":
            self.invalidate_cloud()
            self.checked(client.fs_delete(item["id"], timeout=30))
        else:
            raise ProviderError("不支持的115操作")
        return {"ok": True}

    def copy_directory(self, item, dest, report):
        target = self.mkdir(dest, item["name"])
        for child in self.children(item["id"]):
            report(progress_value("scan", child["name"]))
            self.operation("copy", {"id": child["id"], "destId": target}, report)

    def upload_entry(self, directory, name, parent, report, local_path=None):
        safe_name(name)
        report(progress_value("scan", name))
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            info = os.fstat(fd)
            if stat.S_ISDIR(info.st_mode):
                dest = self.mkdir(parent, name)
                for child in os.listdir(fd):
                    self.upload_entry(fd, child, dest, report, os.path.join(local_path, child) if local_path else None)
            elif stat.S_ISREG(info.st_mode):
                self.ensure_unused(parent, name)
                with os.fdopen(os.dup(fd), "rb") as file:
                    self.upload_file(file, name, parent, report, local_path)
            else:
                raise ProviderError(f"不支持上传链接或特殊文件：{name}")
        finally:
            os.close(fd)

    def upload_file(self, file, name, parent, report, local_path=None):
        before = os.fstat(file.fileno())
        total = before.st_size
        report(progress_value("hash", name, 0, total))
        sha1 = self.local_hash("hash.get", local_path, before)
        if not sha1:
            digest = hashlib.sha1()
            done = 0
            while chunk := file.read(1024*1024):
                digest.update(chunk)
                done += len(chunk)
                report(progress_value("hash", name, done, total))
            sha1 = digest.hexdigest().upper()
        def check_unchanged():
            now = os.fstat(file.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (now.st_size, now.st_mtime_ns, now.st_ctime_ns):
                raise ProviderError("校验或上传期间文件发生变化，请核实云端结果后重新操作")
        check_unchanged()
        report(progress_value("hash", name, total, total))
        check_unchanged()
        self.local_hash("hash.put", local_path, before, sha1)
        check_unchanged()
        file.seek(0)
        report(progress_value("waiting", name))
        uploaded = 0
        cancel_error = None

        def hook(delta):
            nonlocal uploaded, cancel_error
            uploaded += delta
            try:
                check_unchanged()
                report(progress_value("upload", name, min(uploaded, total), total))
            except Exception as error:
                cancel_error = error
                raise
        try:
            # p115oss performs the server's range challenge and falls back to OSS
            # upload. Explicit hash avoids its uninstrumented full-file hashing.
            result = self.load().upload_file(file, pid=parent, filename=name, filesha1=sha1, filesize=total, reporthook=hook, timeout=120)
        except Exception:
            if cancel_error is not None:
                raise cancel_error
            raise
        check_unchanged()
        self.checked(result)

    def download_entry(self, file_id, directory, report, local_directory=None):
        item = self.info(file_id)
        name = safe_name(item["name"])
        report(progress_value("scan", name))
        if item["is_dir"]:
            # mkdir is exclusive; never merge an unreviewed existing tree.
            os.mkdir(name, mode=0o755, dir_fd=directory)
            child_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            try:
                for child in self.children(file_id):
                    self.download_entry(child["id"], child_fd, report, os.path.join(local_directory, name) if local_directory else None)
            finally:
                os.close(child_fd)
            return
        try:
            os.stat(name, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise ProviderError(f"目标已存在：{name}（未覆盖）")
        url = self.load().download_url(item["pickcode"], timeout=30)
        if urlsplit(str(url)).scheme not in ("https", "http"):
            raise ProviderError("115返回无效下载地址")
        temp = ".filebutler-download-" + uuid.uuid4().hex
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        total, done = int(item["size"]), 0
        try:
            digest = hashlib.sha1()
            with os.fdopen(fd, "wb") as file:
                report(progress_value("download", name, 0, total))
                with urlopen(Request(str(url), headers=getattr(url, "headers", {})), timeout=60) as response:
                    while chunk := response.read(1024*1024):
                        file.write(chunk)
                        digest.update(chunk)
                        done += len(chunk)
                        report(progress_value("download", name, done, total))
                file.flush()
                os.fsync(file.fileno())
                downloaded = os.fstat(file.fileno())
            if done != total or (item.get("sha1") and digest.hexdigest().upper() != item["sha1"].upper()):
                raise ProviderError("下载大小或摘要校验失败")
            # Hard-link publication is atomic and refuses replacement of a raced-in file.
            os.link(temp, name, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
        finally:
            os.unlink(temp, dir_fd=directory)
        try:
            published = os.stat(name, dir_fd=directory, follow_symlinks=False)
        except OSError:
            # A concurrent rename after successful publication is not a failed download.
            return
        if (published.st_dev, published.st_ino, published.st_size, published.st_mtime_ns) == (downloaded.st_dev, downloaded.st_ino, downloaded.st_size, downloaded.st_mtime_ns):
            self.local_hash("hash.put", os.path.join(local_directory, name) if local_directory else None, published, digest.hexdigest().upper(), "download")

    def extract(self, item, dest, password, report):
        if item["is_dir"]:
            raise ProviderError("请选择压缩文件")
        client = self.load()
        pickcode = item["pickcode"]
        report(progress_value("extract", item["name"], cancelable=False))
        result = self.checked(client.extract_push({"pick_code": pickcode, "secret": password}, timeout=60))
        deadline = time.monotonic() + 6*3600
        while True:
            status = int(result["data"]["unzip_status"])
            if status == 4:
                break
            if status not in (0, 1):
                raise ProviderError("115压缩包解析失败，请检查密码、格式、大小及账号权限")
            if time.monotonic() > deadline:
                raise ProviderError("云端解压等待超时；远端可能仍在执行，请在115确认状态")
            time.sleep(2)
            report(progress_value("extract", item["name"], cancelable=False))
            result = self.checked(client.extract_push_progress(pickcode, timeout=30))
        # Isolate extraction from existing names; never silently merge/overwrite.
        folder = self.mkdir(dest, os.path.splitext(item["name"])[0])
        result = self.checked(client.extract_file(pickcode, to_pid=folder, timeout=60))
        task_id = result["data"]["extract_id"]
        while time.monotonic() < deadline:
            result = self.checked(client.extract_progress(task_id, timeout=30))
            percent = float(result["data"]["percent"])
            report(progress_value("extract", item["name"], cancelable=False, percent=percent))
            if percent == 100:
                return
            if percent < 0 or percent > 100:
                raise ProviderError("115返回无效解压进度")
            time.sleep(2)
        raise ProviderError("云端解压等待超时；远端可能仍在执行，请在115确认状态")
