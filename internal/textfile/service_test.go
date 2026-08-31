package textfile

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/little6neko/filebutler/internal/roots"
)

func TestServiceReadReturnsDecodedDocumentAndRevision(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "notes.txt")
	raw := append([]byte{0xef, 0xbb, 0xbf}, []byte("第一行\r\n第二行\r\n")...)
	if err := os.WriteFile(path, raw, 0o640); err != nil {
		t.Fatal(err)
	}

	service := testService(directory)
	document, err := service.Read("data", "notes.txt")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if document.Content != "第一行\r\n第二行\r\n" || document.Encoding != EncodingUTF8BOM {
		t.Fatalf("document=%+v", document)
	}
	if document.LineEnding != LineEndingCRLF || document.PreferredLineEnding != LineEndingCRLF {
		t.Fatalf("line endings=%q,%q", document.LineEnding, document.PreferredLineEnding)
	}
	if document.ByteSize != int64(len(raw)) {
		t.Fatalf("ByteSize=%d", document.ByteSize)
	}
	if len(document.Revision) != len("sha256:")+64 || !strings.HasPrefix(document.Revision, "sha256:") {
		t.Fatalf("Revision=%q", document.Revision)
	}
	if document.Revision != Revision(raw) {
		t.Fatalf("Revision=%q want %q", document.Revision, Revision(raw))
	}
}

func TestServiceReadRejectsInvalidTargets(t *testing.T) {
	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, "folder.txt"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "binary.txt"), []byte("a\x00b"), 0o600); err != nil {
		t.Fatal(err)
	}
	large, err := os.Create(filepath.Join(directory, "large.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if err := large.Truncate(MaxFileSize + 1); err != nil {
		t.Fatal(err)
	}
	if err := large.Close(); err != nil {
		t.Fatal(err)
	}

	service := testService(directory)
	tests := []struct {
		name   string
		path   string
		target error
	}{
		{name: "directory", path: "folder.txt", target: ErrNotRegular},
		{name: "missing", path: "missing.txt", target: ErrNotFound},
		{name: "unsupported extension", path: "image.jpg", target: ErrUnsupportedText},
		{name: "outside root", path: "../escape.txt", target: roots.ErrOutsideRoot},
		{name: "binary", path: "binary.txt", target: ErrUnsupportedText},
		{name: "too large", path: "large.txt", target: ErrTooLarge},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, readErr := service.Read("data", test.path); !errors.Is(readErr, test.target) {
				t.Fatalf("Read err=%v", readErr)
			}
		})
	}
}

func TestServiceReadRejectsOutsideSymlinkAndAllowsInsideSymlink(t *testing.T) {
	directory := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "target.txt"), []byte("inside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(directory, "outside.txt")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if err := os.Symlink("target.txt", filepath.Join(directory, "inside.txt")); err != nil {
		t.Fatal(err)
	}

	service := testService(directory)
	if _, err := service.Read("data", "outside.txt"); !errors.Is(err, roots.ErrOutsideRoot) {
		t.Fatalf("outside Read err=%v", err)
	}
	document, err := service.Read("data", "inside.txt")
	if err != nil || document.Content != "inside" {
		t.Fatalf("inside Read document=%+v err=%v", document, err)
	}
}

func TestServiceReadsAndSavesSymlinkAcrossMappedRoots(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	other := filepath.Join(base, "other")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(other, "target.txt")
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "linked.txt")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	service := NewService(roots.NewResolver([]roots.Root{
		{ID: "root", Name: "Root", Path: root},
		{ID: "other", Name: "Other", Path: other},
	}))

	document, err := service.Read("root", "linked.txt")
	if err != nil || document.Content != "old" {
		t.Fatalf("Read document = %+v, err = %v", document, err)
	}
	if _, err := service.Save(SaveRequest{
		RootID: "root", Path: "linked.txt", Content: "new", Encoding: document.Encoding,
		LineEnding: LineEndingLF, Revision: document.Revision,
	}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("link info = %v, err = %v", info, err)
	}
	if got, err := os.ReadFile(target); err != nil || string(got) != "new" {
		t.Fatalf("target = %q, err = %v", got, err)
	}
}

func TestServiceSaveChecksRevisionAndPreservesPermissions(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "notes.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	service := testService(directory)
	document, err := service.Read("data", "notes.txt")
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.Save(SaveRequest{
		RootID: "data", Path: "notes.txt", Content: "new\n", Encoding: document.Encoding,
		LineEnding: LineEndingLF, Revision: document.Revision,
	})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "new\n" || result.ByteSize != int64(len(raw)) || result.Revision != Revision(raw) {
		t.Fatalf("raw=%q result=%+v", raw, result)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("permissions=%o", info.Mode().Perm())
	}

	if _, err := service.Save(SaveRequest{
		RootID: "data", Path: "notes.txt", Content: "stale\n", Encoding: EncodingUTF8,
		LineEnding: LineEndingLF, Revision: document.Revision,
	}); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("stale Save err=%v", err)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "new\n" {
		t.Fatalf("after conflict=%q err=%v", got, err)
	}

	forced, err := service.Save(SaveRequest{
		RootID: "data", Path: "notes.txt", Content: "forced\n", Encoding: EncodingUTF8,
		LineEnding: LineEndingLF, Revision: document.Revision, Force: true,
	})
	if err != nil {
		t.Fatalf("forced Save: %v", err)
	}
	if forced.Revision != Revision([]byte("forced\n")) {
		t.Fatalf("forced=%+v", forced)
	}
}

func TestServiceSaveRejectsInvalidContentAndMissingTarget(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "notes.txt")
	if err := os.WriteFile(path, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := testService(directory)
	document, err := service.Read("data", "notes.txt")
	if err != nil {
		t.Fatal(err)
	}

	largeContent := strings.Repeat("a", int(MaxFileSize+1))
	if _, err := service.Save(SaveRequest{
		RootID: "data", Path: "notes.txt", Content: largeContent, Encoding: EncodingUTF8,
		LineEnding: LineEndingLF, Revision: document.Revision,
	}); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("large Save err=%v", err)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "old" {
		t.Fatalf("after large Save=%q err=%v", got, err)
	}

	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Save(SaveRequest{
		RootID: "data", Path: "notes.txt", Content: "new", Encoding: EncodingUTF8,
		LineEnding: LineEndingLF, Revision: document.Revision,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing Save err=%v", err)
	}
}

func TestServiceSavePreservesInsideSymlink(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target.txt")
	link := filepath.Join(directory, "link.txt")
	if err := os.WriteFile(target, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("target.txt", link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	service := testService(directory)
	document, err := service.Read("data", "link.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Save(SaveRequest{
		RootID: "data", Path: "link.txt", Content: "new", Encoding: document.Encoding,
		LineEnding: LineEndingLF, Revision: document.Revision,
	}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("link replaced info=%v err=%v", info, err)
	}
	if got, err := os.ReadFile(target); err != nil || string(got) != "new" {
		t.Fatalf("target=%q err=%v", got, err)
	}
}

func TestServiceSavePropagatesPermissionErrorWithoutChangingFile(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "notes.txt")
	if err := os.WriteFile(path, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := testService(directory)
	document, err := service.Read("data", "notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	service.atomicWrite = func(string, []byte, fs.FileMode) error { return os.ErrPermission }

	if _, err := service.Save(SaveRequest{
		RootID: "data", Path: "notes.txt", Content: "new", Encoding: document.Encoding,
		LineEnding: LineEndingLF, Revision: document.Revision,
	}); !errors.Is(err, os.ErrPermission) {
		t.Fatalf("Save err=%v", err)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "old" {
		t.Fatalf("after Save=%q err=%v", got, err)
	}
}

func TestServiceConcurrentSaveSerializesRevisionCheckAndWrite(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "notes.txt")
	if err := os.WriteFile(path, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := testService(directory)
	document, err := service.Read("data", "notes.txt")
	if err != nil {
		t.Fatal(err)
	}

	defaultWrite := service.atomicWrite
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	service.atomicWrite = func(path string, data []byte, mode fs.FileMode) error {
		once.Do(func() {
			close(started)
			<-release
		})
		return defaultWrite(path, data, mode)
	}

	request := func(content string) SaveRequest {
		return SaveRequest{
			RootID: "data", Path: "notes.txt", Content: content, Encoding: EncodingUTF8,
			LineEnding: LineEndingLF, Revision: document.Revision,
		}
	}
	type outcome struct {
		result SaveResult
		err    error
	}
	firstResult := make(chan outcome, 1)
	secondResult := make(chan outcome, 1)
	go func() {
		result, saveErr := service.Save(request("first"))
		firstResult <- outcome{result: result, err: saveErr}
	}()
	<-started
	go func() {
		result, saveErr := service.Save(request("second"))
		secondResult <- outcome{result: result, err: saveErr}
	}()
	close(release)

	first := <-firstResult
	second := <-secondResult
	if first.err != nil {
		t.Fatalf("first Save err=%v", first.err)
	}
	if !errors.Is(second.err, ErrRevisionConflict) {
		t.Fatalf("second Save result=%+v err=%v", second.result, second.err)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "first" {
		t.Fatalf("saved=%q err=%v", got, err)
	}
	if got := service.locks.size(); got != 0 {
		t.Fatalf("lock table size=%d", got)
	}
}

func testService(directory string) *Service {
	resolver := roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: directory}})
	return NewService(resolver)
}
