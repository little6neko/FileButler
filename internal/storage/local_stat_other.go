//go:build !linux

package storage

import "os"

func FreshLocalInfo(path string) (os.FileInfo, error) {
	return os.Lstat(path)
}
