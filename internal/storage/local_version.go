package storage

import (
	"encoding/json"
	"os"
	"syscall"
)

// LocalVersion is also used by the Python worker. Keep integers exact and keep
// ctime: same-size edits that restore mtime must not reuse an old digest.
func LocalVersion(info os.FileInfo) string {
	if info == nil || !info.Mode().IsRegular() {
		return ""
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return ""
	}
	b, _ := json.Marshal([]any{st.Dev, st.Ino, st.Mode, info.Size(), st.Mtim.Sec*1e9 + st.Mtim.Nsec, st.Ctim.Sec*1e9 + st.Ctim.Nsec})
	return string(b)
}
