//go:build linux || android

package links

import (
	"errors"
	"os"
	"sync"

	"golang.org/x/sys/unix"
)

// Serialize this helper's target checks and renames, including native calls,
// so concurrent moves through FileButler cannot overwrite each other when the
// filesystem lacks RENAME_NOREPLACE. No file copying or hashing holds this lock.
var renameNoReplaceMu sync.Mutex

func renameNoReplace(source string, destination string) error {
	return renameNoReplaceWith(source, destination, func(source, destination string) error {
		return unix.Renameat2(unix.AT_FDCWD, source, unix.AT_FDCWD, destination, unix.RENAME_NOREPLACE)
	})
}

func renameNoReplaceWith(source, destination string, native func(string, string) error) error {
	renameNoReplaceMu.Lock()
	defer renameNoReplaceMu.Unlock()

	err := native(source, destination)
	if !errors.Is(err, unix.EINVAL) && !errors.Is(err, unix.ENOSYS) && !errors.Is(err, unix.EOPNOTSUPP) {
		return err
	}
	// Older mergerfs returns EINVAL for this flag. Do not fall back for EXDEV,
	// permission errors or conflicts: callers need those errors unchanged.
	// Lstat also rejects dangling symlinks. Unlike the native syscall this check
	// is NOT atomic with rename against other processes or writers that do not
	// use this helper. Ordinary rename still rejects invalid directory moves.
	if _, err := os.Lstat(destination); err == nil {
		return &os.LinkError{Op: "rename", Old: source, New: destination, Err: os.ErrExist}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Rename(source, destination)
}
