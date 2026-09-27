package extract

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

// Check the entire plan before writing into an existing destination. Ordinary
// directories may be reused, but files, links and file/directory conflicts may not.
func checkOutputConflicts(ctx context.Context, out *os.Root, items []entry) error {
	for _, item := range items {
		if err := ctx.Err(); err != nil {
			return err
		}
		parts := strings.Split(item.name, "/")
		for i := range parts {
			name := strings.Join(parts[:i+1], "/")
			info, err := out.Lstat(name)
			if errors.Is(err, os.ErrNotExist) {
				break
			}
			if err != nil {
				return fmt.Errorf("无法检查目标路径 %s：%w", name, err)
			}
			wantDirectory := i < len(parts)-1 || item.directory
			if !wantDirectory || !info.IsDir() {
				return fmt.Errorf("目标冲突：%s（不覆盖文件，不使用链接或特殊条目）", name)
			}
		}
	}
	return nil
}

// Pin each directory without following links, including links swapped in after
// preflight. The proc descriptor path only reopens our own already-verified fd;
// archive-controlled paths are always resolved through os.Root.
// Local extraction already requires Linux for its decoder sandbox.
func openOutputDirectory(out *os.Root, name string) (*os.Root, error) {
	current, err := out.OpenRoot(".")
	if err != nil {
		return nil, err
	}
	if name == "." {
		return current, nil
	}
	for _, part := range strings.Split(name, "/") {
		if err := current.Mkdir(part, 0755); err != nil && !errors.Is(err, os.ErrExist) {
			current.Close()
			return nil, err
		}
		// os.Root resolves in-root symlinks itself; passing O_NOFOLLOW to its
		// OpenFile is not sufficient. Open one component directly with openat.
		parent, err := current.Open(".")
		if err != nil {
			current.Close()
			return nil, err
		}
		fd, err := unix.Openat(int(parent.Fd()), part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		parent.Close()
		if err != nil {
			current.Close()
			return nil, fmt.Errorf("目标子目录不可用或已变化：%s：%w", name, err)
		}
		next, err := os.OpenRoot("/proc/self/fd/" + strconv.Itoa(fd))
		unix.Close(fd)
		current.Close()
		if err != nil {
			return nil, err
		}
		current = next
	}
	return current, nil
}
