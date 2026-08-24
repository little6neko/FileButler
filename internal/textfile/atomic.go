package textfile

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

const atomicTemporaryPattern = ".filebutler-text-*"

type atomicTemporaryFile interface {
	io.Writer
	Chmod(fs.FileMode) error
	Sync() error
	Close() error
	Name() string
}

type atomicOperations struct {
	createTemp    func(directory, pattern string) (atomicTemporaryFile, error)
	rename        func(oldPath, newPath string) error
	remove        func(path string) error
	syncDirectory func(path string) error
}

func defaultAtomicOperations() atomicOperations {
	return atomicOperations{
		createTemp: func(directory, pattern string) (atomicTemporaryFile, error) {
			return os.CreateTemp(directory, pattern)
		},
		rename:        os.Rename,
		remove:        os.Remove,
		syncDirectory: syncDirectory,
	}
}

func atomicReplace(path string, content []byte, mode fs.FileMode) error {
	return atomicReplaceWithOperations(path, content, mode, defaultAtomicOperations())
}

func atomicReplaceWithOperations(path string, content []byte, mode fs.FileMode, operations atomicOperations) error {
	directory := filepath.Dir(path)
	temporary, err := operations.createTemp(directory, atomicTemporaryPattern)
	if err != nil {
		return fmt.Errorf("create temporary text file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() { _ = operations.remove(temporaryPath) }()
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
	}()

	if err := temporary.Chmod(mode.Perm()); err != nil {
		return fmt.Errorf("set temporary text file permissions: %w", err)
	}
	if err := writeAll(temporary, content); err != nil {
		return fmt.Errorf("write temporary text file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("flush temporary text file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary text file: %w", err)
	}
	closed = true
	if err := operations.rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace text file: %w", err)
	}
	if err := operations.syncDirectory(directory); err != nil {
		return fmt.Errorf("flush text file directory: %w", err)
	}
	return nil
}

func writeAll(writer io.Writer, content []byte) error {
	for len(content) > 0 {
		written, err := writer.Write(content)
		if err != nil {
			return err
		}
		if written <= 0 || written > len(content) {
			return io.ErrShortWrite
		}
		content = content[written:]
	}
	return nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return err
	}
	return directory.Close()
}
