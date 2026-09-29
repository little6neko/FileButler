"""Cancelable metadata-only totals, invoked by the delayed job scanner."""
import os
import stat

from errors import ProviderError


def transfer_statistics(ops, params, report):
    from operations import open_directory, progress_value
    def checkpoint():
        report(progress_value("statistics", ""))
    total = {"bytes": 0, "files": 0}
    cloud = params.get("transferMethod") != "upload" and params.get("sourceCloud", True)
    checkpoint()
    if cloud:
        root = ops.info(params["id"])
        if not root["is_dir"]:
            return {"bytes": int(root["size"]), "files": 1}
        pending, seen = [str(root["id"])], {str(root["id"])}
        while pending:
            checkpoint()
            for entry in ops.children(pending.pop(), checkpoint=checkpoint):
                checkpoint()
                key = str(entry["id"])
                if key in seen or len(seen) >= 100000:
                    raise ProviderError("目录层级异常或单项文件过多")
                seen.add(key)
                if entry["isDirectory"]:
                    pending.append(key)
                else:
                    size = int(entry["size"])
                    if size < 0: raise ProviderError("115返回了无效的文件大小")
                    total["files"] += 1
                    total["bytes"] += size
    else:
        def walk(directory, name):
            checkpoint()
            info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                try:
                    for entry in os.listdir(child): walk(child, entry)
                finally: os.close(child)
            elif stat.S_ISREG(info.st_mode):
                total["files"] += 1
                total["bytes"] += info.st_size
            else: raise ProviderError("不支持统计链接或特殊文件")
        path = params["localPath"]
        with open_directory(os.path.dirname(path)) as directory:
            walk(directory, os.path.basename(path))
    checkpoint()
    return total
