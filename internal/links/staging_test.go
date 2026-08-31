package links

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

const testRevision = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestStagingManagerCreatesAndValidatesRestrictedContainer(t *testing.T) {
	parent := t.TempDir()
	manager := NewStagingManager("runtime-1")
	area, err := manager.Create(parent, "job-1", "目标(一)", testRevision)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(area.Container)
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() || info.Mode().Perm() != 0o700 {
		t.Fatalf("container mode = %v", info.Mode())
	}
	marker, valid, err := manager.Validate(area.Container)
	if err != nil || !valid {
		t.Fatalf("Validate marker = %+v, valid = %v, err = %v", marker, valid, err)
	}
	if marker.RuntimeID != "runtime-1" || marker.JobID != "job-1" || marker.DestName != "目标(一)" || marker.PreviewRevision != testRevision {
		t.Fatalf("marker = %+v", marker)
	}

	mustWrite(t, area.Payload, "payload")
	if _, valid, err := manager.Validate(area.Container); err != nil || !valid {
		t.Fatalf("container with payload valid = %v, err = %v", valid, err)
	}
	if err := os.Rename(area.Payload, filepath.Join(parent, marker.DestName)); err != nil {
		t.Fatal(err)
	}
	if _, valid, err := manager.Validate(area.Container); err != nil || !valid {
		t.Fatalf("post-commit container valid = %v, err = %v", valid, err)
	}
	if err := manager.Cleanup(area); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(area.Container); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("container err = %v", err)
	}
}

func TestStagingManagerRejectsLookalikesAndUnexpectedContents(t *testing.T) {
	parent := t.TempDir()
	manager := NewStagingManager("runtime-1")
	lookalike := filepath.Join(parent, stagingPrefix+"user-data")
	if err := os.Mkdir(lookalike, 0o700); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(lookalike, "important.txt"), "user")
	if _, valid, err := manager.Validate(lookalike); err != nil || valid {
		t.Fatalf("lookalike valid = %v, err = %v", valid, err)
	}

	area, err := manager.Create(parent, "job-1", "target", testRevision)
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(area.Container, "unexpected"), "user")
	if _, valid, err := manager.Validate(area.Container); err != nil || valid {
		t.Fatalf("unexpected content valid = %v, err = %v", valid, err)
	}
	if err := manager.Cleanup(area); !errors.Is(err, ErrInvalidStaging) {
		t.Fatalf("Cleanup err = %v, want invalid staging", err)
	}
	if _, err := os.Lstat(area.Container); err != nil {
		t.Fatalf("invalid container was removed: %v", err)
	}
}

func TestStagingManagerRejectsDamagedOrMismatchedMarker(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(StagingArea)
	}{
		{
			name: "damaged json",
			mutate: func(area StagingArea) {
				if err := os.WriteFile(area.MarkerPath, []byte("{"), 0o600); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "name token mismatch",
			mutate: func(area StagingArea) {
				newPath := filepath.Join(filepath.Dir(area.Container), stagingPrefix+"different-token-suffix")
				if err := os.Rename(area.Container, newPath); err != nil {
					t.Fatal(err)
				}
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			manager := NewStagingManager("runtime")
			area, err := manager.Create(t.TempDir(), "job", "target", testRevision)
			if err != nil {
				t.Fatal(err)
			}
			test.mutate(area)
			container := area.Container
			if test.name == "name token mismatch" {
				entries, err := os.ReadDir(filepath.Dir(container))
				if err != nil {
					t.Fatal(err)
				}
				container = filepath.Join(filepath.Dir(container), entries[0].Name())
			}
			if _, valid, err := manager.Validate(container); err != nil || valid {
				t.Fatalf("valid = %v, err = %v", valid, err)
			}
		})
	}
}

func TestStagingManagerCleansPartialContainerWhenCreationFails(t *testing.T) {
	for _, operation := range []string{"mkdir-temp", "chmod", "marker"} {
		t.Run(operation, func(t *testing.T) {
			parent := t.TempDir()
			manager := NewStagingManager("runtime")
			if operation == "marker" {
				manager.writeAtomic = func(string, []byte, os.FileMode) error {
					return errors.New("injected marker failure")
				}
			} else {
				manager.fileSystem = &faultStagingFileSystem{
					stagingFileSystem: osStagingFileSystem{}, operation: operation,
				}
			}
			if _, err := manager.Create(parent, "job", "target", testRevision); err == nil {
				t.Fatalf("%s failure returned nil", operation)
			}
			entries, err := os.ReadDir(parent)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Fatalf("partial container remains: %+v", entries)
			}
		})
	}
}

type faultStagingFileSystem struct {
	stagingFileSystem
	operation string
}

func (fileSystem *faultStagingFileSystem) MkdirTemp(directory string, pattern string) (string, error) {
	if fileSystem.operation == "mkdir-temp" {
		return "", errors.New("injected mkdir-temp failure")
	}
	return fileSystem.stagingFileSystem.MkdirTemp(directory, pattern)
}

func (fileSystem *faultStagingFileSystem) Chmod(path string, mode os.FileMode) error {
	if fileSystem.operation == "chmod" {
		return errors.New("injected chmod failure")
	}
	return fileSystem.stagingFileSystem.Chmod(path, mode)
}

func (fileSystem *faultStagingFileSystem) RemoveAll(path string) error {
	if fileSystem.operation == "remove-all" {
		return errors.New("injected remove-all failure")
	}
	return fileSystem.stagingFileSystem.RemoveAll(path)
}
