//go:build linux

package extract

import (
	"fmt"
	"os"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/unix"
)

const helperArgument = "--internal-archive-reader"

// RunHelper is called before normal application initialization. The child has
// only an inherited read-only archive descriptor and output pipes. Landlock
// additionally denies filesystem writes, including a compromised decoder.
func RunHelper() {
	if len(os.Args) < 3 || os.Args[1] != helperArgument {
		return
	}
	runtime.LockOSThread()
	if err := unix.Setrlimit(unix.RLIMIT_FSIZE, &unix.Rlimit{Cur: 0, Max: 0}); err != nil {
		fmt.Fprintln(os.Stderr, "无法限制解压子进程文件写入：", err)
		os.Exit(125)
	}
	if err := restrictWrites(); err != nil {
		fmt.Fprintln(os.Stderr, "安全解压不可用：Linux Landlock ABI 3 或以上及相应容器权限必需：", err)
		os.Exit(125)
	}
	if err := syscall.Exec(os.Args[2], os.Args[2:], os.Environ()); err != nil {
		fmt.Fprintln(os.Stderr, "启动解压工具失败：", err)
		os.Exit(125)
	}
}

func restrictWrites() error {
	version, _, errno := unix.Syscall(unix.SYS_LANDLOCK_CREATE_RULESET, 0, 0, unix.LANDLOCK_CREATE_RULESET_VERSION)
	if errno != 0 {
		return errno
	}
	if version < 3 {
		return fmt.Errorf("Landlock ABI %d", version)
	}
	// Reading is unrestricted. No rules grant any write or creation rights.
	mask := uint64(unix.LANDLOCK_ACCESS_FS_WRITE_FILE | unix.LANDLOCK_ACCESS_FS_REMOVE_DIR | unix.LANDLOCK_ACCESS_FS_REMOVE_FILE | unix.LANDLOCK_ACCESS_FS_MAKE_CHAR | unix.LANDLOCK_ACCESS_FS_MAKE_DIR | unix.LANDLOCK_ACCESS_FS_MAKE_REG | unix.LANDLOCK_ACCESS_FS_MAKE_SOCK | unix.LANDLOCK_ACCESS_FS_MAKE_FIFO | unix.LANDLOCK_ACCESS_FS_MAKE_BLOCK | unix.LANDLOCK_ACCESS_FS_MAKE_SYM | unix.LANDLOCK_ACCESS_FS_REFER | unix.LANDLOCK_ACCESS_FS_TRUNCATE)
	fd, _, errno := unix.Syscall(unix.SYS_LANDLOCK_CREATE_RULESET, uintptr(unsafe.Pointer(&mask)), unsafe.Sizeof(mask), 0)
	if errno != 0 {
		return errno
	}
	defer unix.Close(int(fd))
	if err := unix.Prctl(unix.PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0); err != nil {
		return err
	}
	_, _, errno = unix.Syscall(unix.SYS_LANDLOCK_RESTRICT_SELF, fd, 0, 0)
	if errno != 0 {
		return errno
	}
	return nil
}
