"""File-version cache, with all persistence owned by the Go backend."""
import json
import ctypes
import os
import stat
import sys
import re
from functools import cache


@cache
def _statx_function():
    function = ctypes.CDLL(None, use_errno=True).statx
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_uint, ctypes.c_void_p]
    function.restype = ctypes.c_int
    return function


def fresh_local_stat(path, dir_fd=None):
    if sys.platform == "linux":
        # Linux struct statx is a 256-byte ABI, aligned to 64 bits. We only need
        # the FORCE_SYNC side effect; os.stat supplies Python's native result.
        attributes = (ctypes.c_uint64 * 32)()
        # AT_FDCWD=-100, AT_SYMLINK_NOFOLLOW=0x100, AT_STATX_FORCE_SYNC=0x2000,
        # STATX_BASIC_STATS=0x7ff. This refreshes attributes, not file data.
        if _statx_function()(-100 if dir_fd is None else dir_fd, os.fsencode(path), 0x2100, 0x7ff, attributes) != 0:
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code), path)
    return os.stat(path, dir_fd=dir_fd, follow_symlinks=False)


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
        # Exact metadata matching and explicit edit invalidation govern reuse.
        # A fresh download/rename alone must not trigger another content read.
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
