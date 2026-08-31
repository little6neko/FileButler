//go:build aix || android || darwin || dragonfly || freebsd || illumos || ios || linux || netbsd || openbsd || solaris

package links

import (
	"fmt"
	"os"
	"syscall"
)

func platformIdentity(_ string, info os.FileInfo, _ bool) (FileIdentity, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return FileIdentity{}, fmt.Errorf("%w: unexpected stat data", ErrIdentityUnsupported)
	}
	return FileIdentity{
		VolumeID: fmt.Sprintf("dev:%x", uint64(stat.Dev)),
		ObjectID: fmt.Sprintf("ino:%x", uint64(stat.Ino)),
	}, nil
}
