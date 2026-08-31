//go:build !aix && !android && !darwin && !dragonfly && !freebsd && !illumos && !ios && !linux && !netbsd && !openbsd && !solaris && !windows

package links

import "os"

func platformIdentity(_ string, _ os.FileInfo, _ bool) (FileIdentity, error) {
	return FileIdentity{}, ErrIdentityUnsupported
}
