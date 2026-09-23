"""Read-only plans and backend-owned transfers; never trust browser filesystem paths."""
import hashlib
import json
import os
import stat

from errors import Canceled, ProviderError


def local_revision(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def local_snapshot(path):
    from operations import open_directory, safe_name
    nodes = {}
    def scan(parent, name, relative):
        safe_name(name)
        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if len(nodes) >= 100000:
            raise ProviderError("单项文件过多，请拆分操作")
        if not stat.S_ISREG(info.st_mode) and not stat.S_ISDIR(info.st_mode):
            raise ProviderError("115传输不支持符号链接或特殊文件")
        nodes[relative] = {"revision": local_revision(info), "directory": stat.S_ISDIR(info.st_mode)}
        if stat.S_ISDIR(info.st_mode):
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                if local_revision(os.fstat(fd)) != local_revision(info):
                    raise ProviderError("源目录发生变化")
                for child in sorted(os.listdir(fd)):
                    scan(fd, child, relative + "/" + child)
            finally:
                os.close(fd)
    with open_directory(os.path.dirname(path)) as parent:
        scan(parent, os.path.basename(path), "")
    return nodes


def remove_local_snapshot(path, expected, report):
    from operations import open_directory, progress_value
    if local_snapshot(path) != expected:
        raise ProviderError("传输成功，源文件发生变化，未删除本地源文件")
    # Walk no-follow directory handles and remove only the recorded entries.
    def remove(parent, name, relative):
        record = expected[relative]
        report(progress_value("delete-source", name))
        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if local_revision(info) != record["revision"]:
            raise ProviderError("传输成功，源文件变化，未完整删除")
        if record["directory"]:
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                if local_revision(os.fstat(fd)) != record["revision"]:
                    raise ProviderError("源目录已替换")
                children = [key for key in expected if key != relative and key.rsplit("/", 1)[0] == relative]
                for child in children:
                    remove(fd, child.rsplit("/", 1)[-1], child)
                current = os.stat(name, dir_fd=parent, follow_symlinks=False)
                if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
                    raise ProviderError("源目录已替换")
                os.rmdir(name, dir_fd=parent)  # Never removes newly added children.
            finally:
                os.close(fd)
        else:
            os.unlink(name, dir_fd=parent)
    with open_directory(os.path.dirname(path)) as parent:
        remove(parent, os.path.basename(path), "")


class SharedFileOperations:
    def verify_download(self, params):
        from operations import open_directory
        with open_directory(params["localDest"]) as fd:
            info = os.fstat(fd)
            if [info.st_dev, info.st_ino] != params["targetRevision"]:
                raise ProviderError("下载目标目录发生变化，保留115源文件")
        cloud = params["snapshot"]
        root = str(params["id"])
        paths = {root: ""}
        def relative(file_id):
            if file_id not in paths:
                node = cloud[file_id]
                paths[file_id] = relative(node["parent"]) + "/" + node["name"]
            return paths[file_id]
        target = os.path.join(params["localDest"], cloud[root]["name"])
        local = local_snapshot(target)
        for file_id, node in cloud.items():
            path = relative(file_id)
            record = local.get(path)
            if not record or record["directory"] != node["directory"] or (not node["directory"] and record["revision"][3] != node["size"]):
                raise ProviderError("下载目标不完整或已变化，保留115源文件")
        if len(local) != len(cloud):
            raise ProviderError("下载目标目录内容发生变化")
        return target, local, paths

    def verify_upload(self, params):
        # Metadata only: no re-download or second content hash.
        source = params["snapshot"]
        top = self.find_child(params["destId"], os.path.basename(params["localPath"]))
        cloud = self.cloud_snapshot(top["id"])
        by_parent = {}
        for file_id, node in cloud.items():
            by_parent.setdefault(node["parent"], []).append((file_id, node))
        def check(file_id, relative):
            node, record = cloud[file_id], source.get(relative)
            if not record or node["directory"] != record["directory"] or (not node["directory"] and node["size"] != record["revision"][3]):
                raise ProviderError("115尚未确认完整上传，保留本地源文件")
            for child_id, child in by_parent.get(file_id, []):
                check(child_id, relative + "/" + child["name"])
        check(str(top["id"]), "")
        if len(cloud) != len(source):
            raise ProviderError("115目标目录不完整，保留本地源文件")

    def cloud_snapshot(self, file_id):
        from operations import safe_name
        nodes = {}
        def scan(file_id):
            if str(file_id) in nodes or len(nodes) >= 100000:
                raise ProviderError("目录层级异常或单项文件过多")
            item = self.info(file_id)
            safe_name(item["name"])
            nodes[str(file_id)] = {"name": item["name"], "parent": str(item["parent_id"]), "directory": bool(item["is_dir"]), "size": int(item.get("size") or 0), "mtime": int(item.get("mtime") or 0), "sha1": item.get("sha1") or ""}
            if item["is_dir"]:
                for child in self.children(file_id):
                    scan(child["id"])
        scan(file_id)
        return nodes

    def check_operation_account(self, params):
        if str(self.load().user_id) != params.get("accountId"):
            raise ProviderError("115账号已变化，请重新预览")

    def operation_plan(self, params):
        from operations import open_directory, safe_name
        self.check_operation_account(params)
        source_cloud, target_cloud = params["sourceCloud"], params["targetCloud"]
        operation = params["type"]
        dest = params.get("destId", "0")
        target_revision = None
        occupied = set()
        ancestors = set()
        if operation != "delete":
            if target_cloud:
                current = str(dest)
                while current != "0":
                    if current in ancestors:
                        raise ProviderError("目标目录层级异常")
                    ancestors.add(current)
                    attr = self.info(current)
                    if not attr["is_dir"]:
                        raise ProviderError("目标不是文件夹")
                    current = str(attr["parent_id"])
                occupied = {child["name"] for child in self.children(dest)}
                target_revision = sorted(ancestors)
            else:
                with open_directory(params["localDest"]) as directory:
                    info = os.fstat(directory)
                    target_revision = [info.st_dev, info.st_ino]
                    occupied = set(os.listdir(directory))
        items, entries, selected_nodes = [], [], set()
        for source in params["sources"]:
            name = source.get("id") or os.path.basename(source["localPath"])
            item = {"operation": operation, "sourcePath": name, "conflict": False}
            try:
                snapshot = self.cloud_snapshot(source["id"]) if source_cloud else local_snapshot(source["localPath"])
                root = snapshot[str(source["id"])] if source_cloud else snapshot[""]
                name = safe_name(root["name"] if source_cloud else os.path.basename(source["localPath"]))
                item["sourcePath"] = name
                if source_cloud:
                    if selected_nodes.intersection(snapshot):
                        raise ProviderError("选择包含重复或嵌套的源文件")
                    selected_nodes.update(snapshot)
                else:
                    path = source["localPath"]
                    if any(os.path.commonpath([path, previous]) in (path, previous) for previous in selected_nodes):
                        raise ProviderError("选择包含嵌套的源目录")
                    selected_nodes.add(path)
                if operation != "delete":
                    item["destPath"] = name
                    if source_cloud and target_cloud:
                        if root["parent"] == str(dest):
                            raise ProviderError("目标仍在当前文件夹")
                        if str(source["id"]) in ancestors:
                            raise ProviderError("不能复制或移动到自身或子目录")
                    if name in occupied:
                        raise ProviderError(f"目标已存在：{name}（未覆盖）")
                    occupied.add(name)
                entry = {key: value for key, value in params.items() if key != "sources"}
                entry.update(source)
                entry.update(snapshot=snapshot, targetRevision=target_revision)
                entries.append(entry)
            except (ProviderError, OSError) as error:
                item.update(conflict=True, errorText=str(error))
            items.append(item)
        revision = hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return {"items": items, "hasConflict": any(item["conflict"] for item in items), "entries": entries, "revision": revision}

    def operation_execute(self, params, report):
        from operations import open_directory, progress_value
        self.check_operation_account(params)
        source_cloud, target_cloud = params["sourceCloud"], params["targetCloud"]
        source = {"id": params["id"]} if source_cloud else {"localPath": params["localPath"]}
        fresh = self.operation_plan({**params, "sources": [source]})
        if fresh["hasConflict"] or fresh["entries"][0]["snapshot"] != params["snapshot"] or fresh["entries"][0]["targetRevision"] != params["targetRevision"]:
            raise ProviderError("源或目标已变化，请重新预览")
        operation = params["type"]
        report(progress_value("scan", fresh["items"][0]["sourcePath"]))
        if source_cloud and (target_cloud or operation == "delete"):
            return self.operation(operation, {"id": params["id"], "destId": params.get("destId", "0")}, report)
        if source_cloud:
            self.operation("download", {"id": params["id"], "localPath": params["localDest"]}, report)
        else:
            self.operation("upload", {"localPath": params["localPath"], "destId": params["destId"]}, report)
        if operation != "move":
            return {"ok": True}
        report(progress_value("delete-source", fresh["items"][0]["sourcePath"]))
        try:
            if source_cloud:
                local_target, downloaded, paths = self.verify_download(params)
                if self.cloud_snapshot(params["id"]) != params["snapshot"]:
                    raise ProviderError("115源文件发生变化，未删除")
                # Remove recorded leaves first; never issue a recursive delete
                # against a directory which has acquired untransferred children.
                remaining = dict(params["snapshot"])
                while remaining:
                    parents = {node["parent"] for node in remaining.values()}
                    leaves = [file_id for file_id in remaining if file_id not in parents]
                    if not leaves:
                        raise ProviderError("源目录层级异常")
                    for file_id in leaves:
                        node = remaining[file_id]
                        report(progress_value("delete-source", node["name"], cancelable=False))
                        local_path = local_target + paths[file_id]
                        with open_directory(os.path.dirname(local_path)) as directory:
                            actual = os.stat(os.path.basename(local_path), dir_fd=directory, follow_symlinks=False)
                            if local_revision(actual) != downloaded[paths[file_id]]["revision"]:
                                raise ProviderError("本地副本发生变化，保留对应115源文件")
                        current = self.info(file_id)
                        if current["name"] != node["name"] or str(current["parent_id"]) != node["parent"] or bool(current["is_dir"]) != node["directory"]:
                            raise ProviderError("源文件已变化")
                        if node["directory"]:
                            if list(self.children(file_id)):
                                raise ProviderError("源目录含未传输的文件，未删除")
                        elif int(current.get("size") or 0) != node["size"] or (current.get("sha1") or "") != node["sha1"] or int(current.get("mtime") or 0) != node["mtime"]:
                            raise ProviderError("源文件内容已变化")
                        self.checked(self.load().fs_delete(file_id, timeout=30))
                        del remaining[file_id]
            else:
                self.verify_upload(params)
                remove_local_snapshot(params["localPath"], params["snapshot"], report)
        except Canceled:
            raise
        except Exception as error:
            raise ProviderError(f"传输成功，源文件删除失败：{error}") from error
        return {"ok": True}
