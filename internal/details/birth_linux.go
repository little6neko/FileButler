package details

import "golang.org/x/sys/unix"

func birthTime(path string) *int64 {
	var st unix.Statx_t
	if unix.Statx(unix.AT_FDCWD, path, unix.AT_SYMLINK_NOFOLLOW, unix.STATX_BTIME, &st) != nil || st.Mask&unix.STATX_BTIME == 0 {
		return nil
	}
	n := st.Btime.Sec
	return &n
}
