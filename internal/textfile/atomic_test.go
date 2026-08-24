package textfile

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicReplacePublishesCompleteFile(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "notes.txt")
	if err := os.WriteFile(path, []byte("old"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := atomicReplace(path, []byte("new content"), 0o640); err != nil {
		t.Fatalf("atomicReplace: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new content" {
		t.Fatalf("content=%q", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("permissions=%o", info.Mode().Perm())
	}
	assertNoAtomicTemporaryFiles(t, directory)
}

func TestAtomicReplaceFailuresLeaveOriginalAndCleanTemporaryFile(t *testing.T) {
	tests := []struct {
		name      string
		failWrite bool
		failSync  bool
		failClose bool
		failMove  bool
	}{
		{name: "write", failWrite: true},
		{name: "sync", failSync: true},
		{name: "close", failClose: true},
		{name: "rename", failMove: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			path := filepath.Join(directory, "notes.txt")
			if err := os.WriteFile(path, []byte("old"), 0o600); err != nil {
				t.Fatal(err)
			}
			injected := errors.New("injected " + test.name + " failure")
			operations := defaultAtomicOperations()
			createTemp := operations.createTemp
			operations.createTemp = func(directory, pattern string) (atomicTemporaryFile, error) {
				file, err := createTemp(directory, pattern)
				if err != nil {
					return nil, err
				}
				return &failingTemporaryFile{
					atomicTemporaryFile: file,
					writeErr:            chooseError(test.failWrite, injected),
					syncErr:             chooseError(test.failSync, injected),
					closeErr:            chooseError(test.failClose, injected),
				}, nil
			}
			if test.failMove {
				operations.rename = func(string, string) error { return injected }
			}

			err := atomicReplaceWithOperations(path, []byte("new"), 0o600, operations)
			if !errors.Is(err, injected) {
				t.Fatalf("error=%v", err)
			}
			if got, err := os.ReadFile(path); err != nil || string(got) != "old" {
				t.Fatalf("content=%q err=%v", got, err)
			}
			assertNoAtomicTemporaryFiles(t, directory)
		})
	}
}

type failingTemporaryFile struct {
	atomicTemporaryFile
	writeErr error
	syncErr  error
	closeErr error
}

func (f *failingTemporaryFile) Write(data []byte) (int, error) {
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	return f.atomicTemporaryFile.Write(data)
}

func (f *failingTemporaryFile) Sync() error {
	if f.syncErr != nil {
		return f.syncErr
	}
	return f.atomicTemporaryFile.Sync()
}

func (f *failingTemporaryFile) Close() error {
	err := f.atomicTemporaryFile.Close()
	if f.closeErr != nil {
		return f.closeErr
	}
	return err
}

func chooseError(enabled bool, err error) error {
	if enabled {
		return err
	}
	return nil
}

func assertNoAtomicTemporaryFiles(t *testing.T, directory string) {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(directory, atomicTemporaryPattern))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary files remain: %v", matches)
	}
}

var _ atomicTemporaryFile = (*failingTemporaryFile)(nil)
