"""Read-only batch snapshots and verified, recoverable cloud rename execution."""
import json
import os
import tempfile
import uuid

from errors import ProviderError


class BatchOperations:
    def batch_children(self, parent):
        entries = []
        for entry in self.children(parent):
            entries.append(entry)
            if len(entries) > 10000:
                raise ProviderError("目录超过单次批量处理上限10000项，请分组操作")
        ids, names = set(), set()
        for entry in entries:
            from operations import safe_name
            safe_name(entry["name"])
            if entry["id"] in ids or entry["name"] in names:
                raise ProviderError("目录中存在重复ID或同名项目，请先处理后重新预览")
            ids.add(entry["id"])
            names.add(entry["name"])
        return entries

    def batch_scan(self, params):
        client = self.load()
        kind = params["kind"]
        directories = {}

        def directory(file_id, path):
            file_id = str(file_id)
            if file_id not in directories:
                info = self.info(file_id) if file_id != "0" else {"name": "115网盘", "parent_id": "0", "is_dir": True}
                if not info["is_dir"]:
                    raise ProviderError("预览目录不存在")
                directories[file_id] = {"id": file_id, "parentId": str(info["parent_id"]), "name": info["name"], "path": path, "entries": self.batch_children(file_id)}
            return directories[file_id]

        if kind == "power":
            selected = set()
            pending = list(params["ids"])
            while pending:
                file_id = str(pending.pop())
                if file_id in selected:
                    continue
                info = self.info(file_id)
                parent_id = str(info["parent_id"])
                group = directory(parent_id, parent_id)
                if not any(entry["id"] == file_id and entry["name"] == info["name"] for entry in group["entries"]):
                    raise ProviderError("目录发生变化，请重新预览")
                selected.add(file_id)
                if len(selected) > 10000:
                    raise ProviderError("单次批量处理最多10000项，请缩小范围")
                if info["is_dir"] and params.get("recursive"):
                    pending.extend(entry["id"] for entry in directory(file_id, file_id)["entries"])
            return {"accountId": str(client.user_id), "groups": list(directories.values()), "selectedIds": sorted(selected)}

        scope = str(params["parentId"])
        if scope != "0" and not self.info(scope)["is_dir"]:
            raise ProviderError("目录不存在")
        paths = params.get("paths")
        if paths is None:
            paths = [entry["name"] for entry in self.batch_children(scope) if entry["isDirectory"] and not entry["name"].startswith(".filebutler-")]
        groups = []
        for path in paths:
            current = scope
            parts = path.split("/")
            if not parts or any(part in ("", ".", "..") or "\\" in part or part.startswith(".filebutler-") or (index > 0 and part == "视频") for index, part in enumerate(parts)):
                raise ProviderError("无效的分组路径")
            for part in parts:
                matches = [entry for entry in self.batch_children(current) if entry["isDirectory"] and entry["name"] == part]
                if len(matches) != 1:
                    raise ProviderError("分组目录已变更，请重新预览")
                current = matches[0]["id"]
            group = directory(current, path)
            video = next((entry for entry in group["entries"] if entry["name"] == "视频" and entry["isDirectory"]), None)
            group["videoId"] = video["id"] if video else ""
            group["videoEntries"] = self.batch_children(video["id"]) if video else []
            groups.append(group)
        return {"accountId": str(client.user_id), "groups": groups, "selectedIds": []}

    def batch_execute(self, params, report):
        from operations import progress_value, safe_name
        client = self.load()
        if str(client.user_id) != params["accountId"]:
            raise ProviderError("115账号已变化，请重新预览")
        items = params["items"]
        if not items:
            return {"ok": True}
        for item in items:
            safe_name(item["name"])
            safe_name(item["targetName"])
            report(progress_value("scan", item["name"]))
            current = self.info(item["id"])
            if str(current["parent_id"]) != item["parentId"] or current["name"] != item["name"]:
                raise ProviderError("源文件已变更，请重新预览")
        sources = {item["id"] for item in items}
        targets = set()
        directories = {}
        def children(parent):
            if parent not in directories:
                directories[parent] = self.batch_children(parent)
            return directories[parent]

        for guard in params.get("guards", []):
            if guard["id"] == "0":
                continue
            current = self.info(guard["id"])
            if not current["is_dir"] or str(current["parent_id"]) != guard["parentId"] or current["name"] != guard["name"]:
                raise ProviderError("分组目录已变化，请重新预览")
            if guard.get("videoId"):
                video = self.info(guard["videoId"])
                if not video["is_dir"] or video["name"] != "视频" or str(video["parent_id"]) != guard["id"]:
                    raise ProviderError("视频目录已变化，请重新预览")
        for item in items:
            target = (item["destId"], item.get("videoParentId", ""), item["targetName"])
            if target in targets:
                raise ProviderError("批量目标名称重复")
            targets.add(target)
            if item["destId"]:
                for entry in children(item["destId"]):
                    if entry["name"] == item["targetName"] and entry["id"] not in sources:
                        raise ProviderError("目标名称已被占用，请重新预览")
            elif any(entry["name"] == "视频" for entry in children(item["videoParentId"])):
                raise ProviderError("视频目录已发生变化，请重新预览")

        # Journal contains only IDs/names, never cookies; persist before mutations.
        token = uuid.uuid4().hex
        directory = self.credentials.parent / "115-recovery"
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        journal = directory / (token + ".json")
        states = [{**item, "currentName": item["name"], "currentParentId": item["parentId"], "stageName": ".filebutler-rename-" + token + "-" + str(index)} for index, item in enumerate(items)]
        record = {"accountId": params["accountId"], "items": states, "status": "preparing"}

        def save():
            fd, filename = tempfile.mkstemp(dir=directory)
            try:
                with os.fdopen(fd, "w") as file:
                    json.dump(record, file, ensure_ascii=False)
                    file.flush()
                    os.fsync(file.fileno())
                os.replace(filename, journal)
            finally:
                if os.path.exists(filename):
                    os.unlink(filename)

        def verified_change(item, name=None, parent=None):
            before = self.info(item["id"])
            if before["name"] != item["currentName"] or str(before["parent_id"]) != item["currentParentId"]:
                raise ProviderError("文件被其他操作修改，停止继续重命名")
            expected_name = name if name is not None else item["currentName"]
            expected_parent = parent if parent is not None else item["currentParentId"]
            self.ensure_unused(expected_parent, expected_name, item["id"])
            item["attempted"] = True
            item["pending"] = {"name": expected_name, "parentId": expected_parent}
            save()
            error = None
            try:
                if name is not None:
                    self.checked(client.fs_rename((item["id"], name), timeout=30))
                else:
                    self.checked(client.fs_move(item["id"], pid=parent, timeout=30))
            except Exception as caught:
                error = caught
            # An uncertain write is never replayed; verify by stable ID.
            actual = self.info(item["id"])
            if actual["name"] != expected_name or str(actual["parent_id"]) != expected_parent:
                raise ProviderError("115未确认操作结果，已停止；请查看恢复记录") from error
            item["currentName"], item["currentParentId"] = expected_name, expected_parent
            item.pop("pending", None)
            save()

        save()
        try:
            # Once staging starts, finish or recover this group before cancellation.
            report(progress_value("waiting", items[0]["name"], cancelable=False, percent=0))
            for item in states:
                verified_change(item, name=item["stageName"])
            new_video_dirs = {}
            for item in states:
                if not item["destId"]:
                    parent = item["videoParentId"]
                    if parent not in new_video_dirs:
                        new_video_dirs[parent] = self.mkdir(parent, "视频")
                    item["destId"] = new_video_dirs[parent]
            for index, item in enumerate(states):
                if item["destId"] != item["currentParentId"]:
                    verified_change(item, parent=item["destId"])
                verified_change(item, name=item["targetName"])
                report(progress_value("waiting", item["targetName"], cancelable=False, percent=int((index + 1) * 100 / len(states))))
            record["status"] = "completed"
            save()
            journal.unlink()
            return {"ok": True}
        except Exception as error:
            touched = [item for item in states if item.get("attempted")]
            if not touched:
                journal.unlink()
                raise
            record["status"] = "recovering"
            save()
            recovered = True
            # Stage finalized names again before restoring, so swaps can unwind.
            for item in reversed(touched):
                try:
                    if item["currentName"] != item["stageName"]:
                        verified_change(item, name=item["stageName"])
                except Exception:
                    recovered = False
            for item in touched:
                try:
                    if item["currentParentId"] != item["parentId"]:
                        verified_change(item, parent=item["parentId"])
                    verified_change(item, name=item["name"])
                except Exception:
                    recovered = False
            record["status"] = "restored" if recovered else "recovery_required"
            save()
            if recovered:
                journal.unlink()
                raise ProviderError("批量操作失败，原名称已恢复；可能保留新建的空视频目录，请刷新后检查") from error
            raise ProviderError("批量操作未全部完成，已保留恢复记录115-recovery/" + token + ".json；请勿重复执行") from error
