//go:build !android && !darwin && !ios && !linux && !windows

package links

import (
	"errors"
	"os"
)

func renameNoReplace(source string, destination string) error {
	if _, err := os.Lstat(destination); err == nil {
		return ErrTargetExists
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Rename(source, destination)
}
