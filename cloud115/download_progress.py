"""One folder's cumulative byte stream, independent of its current leaf name."""
import uuid


class FolderDownloadProgress:
    def __init__(self, report, name, total, files_total):
        self.report = report
        self.name = name
        self.total = total
        self.warning = ""
        self.files_total = files_total
        self.files_done = 0
        self.done = 0
        self.current_done = 0
        self.scope = "folder-download-" + uuid.uuid4().hex

    def __call__(self, progress):
        self.name = progress["file"]
        if progress["phase"] == "scan":
            self.current_done = 0
        elif progress["phase"] == "download":
            self.done += progress["bytesDone"] - self.current_done
            self.current_done = progress["bytesDone"]
            if progress.get("fileComplete"):
                self.files_done += 1
        if self.total is not None and self.done > self.total:
            self.invalidate_total()
        self.emit()

    def invalidate_total(self):
        self.total = None
        self.warning = "扫描后文件大小发生变化，总字节进度暂不可用"

    def emit(self, complete=False):
        value = {"phase": "download", "scope": self.scope, "file": self.name,
                 "bytesDone": self.done, "bytesTotal": self.total or 0, "cancelable": True,
                 "filesDone": self.files_done, "filesTotal": self.files_total}
        if self.warning:
            value["warning"] = self.warning
        if self.total is not None:
            # Publication/checks and remaining empty directories must finish
            # before reporting 100%, even when all known bytes arrived.
            value["percent"] = 100 if complete else min(99.9, self.done / self.total * 100) if self.total else 0
        self.report(value)

    def finish(self):
        if self.total is not None and self.done != self.total:
            self.invalidate_total()
        self.emit(complete=True)
