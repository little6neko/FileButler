//go:build linux

package storage

import (
	"golang.org/x/sys/unix"
	"os"
)

// FreshLocalInfo bypasses FUSE's cached attributes after an owned rename/link.
// FORCE_SYNC fetches metadata only: no content read, fsync, polling or delay.
func FreshLocalInfo(path string) (os.FileInfo, error) {
	var attributes unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, path, unix.AT_SYMLINK_NOFOLLOW|unix.AT_STATX_FORCE_SYNC, unix.STATX_BASIC_STATS, &attributes); err != nil {
		return nil, &os.PathError{Op: "statx", Path: path, Err: err}
	}
	return os.Lstat(path)
}
