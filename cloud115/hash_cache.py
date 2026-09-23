"""File-version cache, with all persistence owned by the Go backend."""
import json
import stat
import time
import re


def local_version(info):
    if not stat.S_ISREG(info.st_mode) or not info.st_ino: return None
    return json.dumps([info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns], separators=(",", ":"))


class HashCache:
    storage = None

    def cache(self, method, params):
        if self.storage is None: return None
        try: return self.storage.call(method, params)
        except Exception:
            # Cache failure must not turn a completed upload into a retry.
            try: self.storage.call("cache.warning")
            except Exception: pass
            return None

    def local_hash(self, method, path, info, sha1="", origin="local"):
        # Timestamp precision varies by filesystem. Never trust a cache hit
        # for a file still inside a recent timestamp-resolution window.
        if method == "hash.get" and time.time_ns() - max(info.st_ctime_ns, info.st_mtime_ns) < 2_000_000_000:
            return None
        version = local_version(info)
        if path and version:
            value = self.cache(method, {"path": path, "version": version, "sha1": sha1, "origin": origin})
            if method == "hash.get" and (not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", value)):
                return None
            return value

    def cloud_hash(self, item):
        digest = item.get("sha1") or ""
        if self.storage is not None and digest and not item.get("is_dir"):
            self.cache("hash.put", {"account": str(self.load().user_id), "fileId": str(item["id"]), "version": json.dumps([int(item.get("size") or 0), int(item.get("mtime") or 0), digest.upper()]), "sha1": digest, "origin": "115"})

    def invalidate_cloud(self):
        # IDs survive renames, but bulk directory deletion lacks a cheap complete ID list.
        if self.storage is not None:
            self.cache("hash.invalidate", {"account": str(self.load().user_id)})

    def invalidate_local(self, path):
        self.cache("hash.invalidate", {"path": path})
