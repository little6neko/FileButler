package extract

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
)

func TestMain(m *testing.M) { RunHelper(); os.Exit(m.Run()) }

func fixture(t *testing.T, name string) (Service, Request, string) {
	t.Helper()
	if _, err := findTool(); err != nil {
		t.Skip(err)
	}
	dir := t.TempDir()
	return Service{Roots: roots.NewResolver([]roots.Root{{ID: "a", Path: dir}})}, Request{SourceRoot: "a", SourcePath: name, DestRoot: "a", DestPath: ".", Name: "output"}, dir
}

func zipFixture(t *testing.T, file string, names ...string) {
	t.Helper()
	f, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	w := zip.NewWriter(f)
	for _, name := range names {
		out, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := out.Write([]byte("hello " + name)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestZIPExtract(t *testing.T) {
	s, req, dir := fixture(t, "中文.zip")
	zipFixture(t, filepath.Join(dir, req.SourcePath), "子目录/文件.txt", "empty-name[1]*.txt")
	var progress jobs.TransferProgress
	ctx := jobs.WithReporter(context.Background(), func(p jobs.TransferProgress) error { progress = p; return nil })
	if err := s.Execute(ctx, req); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"子目录/文件.txt", "empty-name[1]*.txt"} {
		data, err := os.ReadFile(filepath.Join(dir, "output", name))
		if err != nil || string(data) != "hello "+name {
			t.Fatalf("%s: %q %v", name, data, err)
		}
	}
	if progress.FilesDone == nil || *progress.FilesDone != 2 || progress.BytesDone != progress.BytesTotal {
		t.Fatalf("progress: %+v", progress)
	}
	if err := s.Execute(ctx, req); err == nil {
		t.Fatal("existing destination accepted")
	}
}

func TestDirectExtractionReusesDirectoriesWithoutChangingExistingFiles(t *testing.T) {
	s, req, dir := fixture(t, "direct.zip")
	req.Name = ""
	zipFixture(t, filepath.Join(dir, req.SourcePath), "existing/new.txt", "new.txt")
	if err := os.Mkdir(filepath.Join(dir, "existing"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "existing/original.txt"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.Execute(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"existing/new.txt", "new.txt"} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || string(data) != "hello "+name {
			t.Fatalf("%q %v", data, err)
		}
	}
	data, err := os.ReadFile(filepath.Join(dir, "existing/original.txt"))
	if err != nil || string(data) != "keep" {
		t.Fatalf("original changed: %q %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "direct")); !os.IsNotExist(err) {
		t.Fatalf("unexpected wrapper directory: %v", err)
	}
}

func TestDirectExtractionChecksEveryConflictBeforeWriting(t *testing.T) {
	for _, kind := range []string{"file", "directory", "symlink", "ancestor-file", "ancestor-symlink"} {
		t.Run(kind, func(t *testing.T) {
			s, req, dir := fixture(t, "conflict.zip")
			req.Name = ""
			zipFixture(t, filepath.Join(dir, req.SourcePath), "a-new.txt", "z-existing/file.txt")
			existing := filepath.Join(dir, "z-existing")
			if kind == "ancestor-file" {
				if err := os.WriteFile(existing, []byte("keep"), 0600); err != nil {
					t.Fatal(err)
				}
			} else if kind == "ancestor-symlink" {
				if err := os.Symlink(t.TempDir(), existing); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Mkdir(existing, 0755); err != nil {
					t.Fatal(err)
				}
				target := filepath.Join(existing, "file.txt")
				switch kind {
				case "file":
					if err := os.WriteFile(target, []byte("keep"), 0600); err != nil {
						t.Fatal(err)
					}
				case "directory":
					if err := os.Mkdir(target, 0755); err != nil {
						t.Fatal(err)
					}
				case "symlink":
					if err := os.Symlink("missing", target); err != nil {
						t.Fatal(err)
					}
				}
			}
			err := s.Execute(context.Background(), req)
			if err == nil {
				t.Fatal("conflict accepted")
			}
			if strings.Contains(err.Error(), "保留部分") {
				t.Fatalf("preflight incorrectly reported writes: %v", err)
			}
			if _, err := os.Stat(filepath.Join(dir, "a-new.txt")); !os.IsNotExist(err) {
				t.Fatalf("wrote before checking all entries: %v", err)
			}
			if kind == "file" {
				data, err := os.ReadFile(filepath.Join(existing, "file.txt"))
				if err != nil || string(data) != "keep" {
					t.Fatalf("original changed: %q %v", data, err)
				}
			}
		})
	}
}

func TestDirectCancellationPreservesOriginalFiles(t *testing.T) {
	s, req, dir := fixture(t, "direct.zip")
	req.Name = ""
	zipFixture(t, filepath.Join(dir, req.SourcePath), "a-new.txt", "b-new.txt")
	if err := os.WriteFile(filepath.Join(dir, "original.txt"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx = jobs.WithReporter(ctx, func(p jobs.TransferProgress) error {
		if p.BytesDone > 0 {
			cancel()
			return context.Canceled
		}
		return nil
	})
	err := s.Execute(ctx, req)
	if !errors.Is(err, context.Canceled) || !strings.Contains(err.Error(), "保留部分") {
		t.Fatalf("%v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "original.txt"))
	if err != nil || string(data) != "keep" {
		t.Fatalf("original changed: %q %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "a-new.txt")); err != nil {
		t.Fatal("partial file was removed", err)
	}
}

func TestWriterRejectsInternalSymlinkInsertedAfterPreflight(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "untouched"), 0755); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	item := entry{name: "nested/a.txt", size: 5}
	if err := checkOutputConflicts(context.Background(), root, []entry{item}); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("untouched", filepath.Join(dir, "nested")); err != nil {
		t.Fatal(err)
	}
	done := 0
	err = writeEntry(context.Background(), root, item, &jobs.TransferProgress{FilesDone: &done}, func(w io.Writer) error { _, err := w.Write([]byte("wrong")); return err })
	if err == nil {
		t.Fatal("raced-in internal symlink accepted")
	}
	if _, err := os.Stat(filepath.Join(dir, "untouched/a.txt")); !os.IsNotExist(err) {
		t.Fatalf("wrote through symlink: %v", err)
	}
}

func TestEncrypted7z(t *testing.T) {
	s, req, dir := fixture(t, "encrypted.7z")
	if err := os.WriteFile(filepath.Join(dir, "data.txt"), []byte("secret content"), 0600); err != nil {
		t.Fatal(err)
	}
	tool, _ := findTool()
	cmd := exec.Command(tool, "a", "-mhe=on", "-pfixture-password", filepath.Join(dir, req.SourcePath), filepath.Join(dir, "data.txt"))
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("fixture: %s %v", output, err)
	}
	req.Password = "wrong-password"
	if err := s.Execute(context.Background(), req); err == nil || strings.Contains(err.Error(), req.Password) {
		t.Fatalf("wrong password: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "output")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("output created before header check: %v", err)
	}
	req.Password = "fixture-password"
	if err := s.Execute(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "output", "data.txt"))
	if err != nil || string(data) != "secret content" {
		t.Fatalf("%q %v", data, err)
	}
}

func TestUnsafeZIP(t *testing.T) {
	for _, name := range []string{"../escape", "/absolute", "C:/drive", "dir/../../escape"} {
		t.Run(name, func(t *testing.T) {
			s, req, dir := fixture(t, "bad.zip")
			zipFixture(t, filepath.Join(dir, req.SourcePath), name)
			if err := s.Execute(context.Background(), req); err == nil {
				t.Fatal("unsafe path accepted")
			}
			if _, err := os.Stat(filepath.Join(dir, "output")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("output exists: %v", err)
			}
		})
	}
}

func TestTarAndLinks(t *testing.T) {
	for _, link := range []bool{false, true} {
		t.Run(map[bool]string{false: "regular", true: "link"}[link], func(t *testing.T) {
			s, req, dir := fixture(t, "bundle.tar.gz")
			var buf bytes.Buffer
			gz := gzip.NewWriter(&buf)
			tw := tar.NewWriter(gz)
			header := &tar.Header{Name: "./nested/a.txt", Mode: 04777, Size: 5, Typeflag: tar.TypeReg}
			if link {
				header.Typeflag, header.Linkname, header.Size = tar.TypeSymlink, "/tmp", 0
			}
			if err := tw.WriteHeader(header); err != nil {
				t.Fatal(err)
			}
			if !link {
				_, _ = tw.Write([]byte("hello"))
			}
			_ = tw.Close()
			_ = gz.Close()
			if err := os.WriteFile(filepath.Join(dir, req.SourcePath), buf.Bytes(), 0600); err != nil {
				t.Fatal(err)
			}
			err := s.Execute(context.Background(), req)
			if link {
				if err == nil {
					t.Fatal("link accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			info, err := os.Stat(filepath.Join(dir, "output/nested/a.txt"))
			if err != nil || info.Mode().Perm() != 0644 || info.Mode()&os.ModeSetuid != 0 {
				t.Fatalf("unsafe permissions: %v %v", info, err)
			}
		})
	}
}

func TestCancelRetainsPartialFiles(t *testing.T) {
	s, req, dir := fixture(t, "cancel.zip")
	zipFixture(t, filepath.Join(dir, req.SourcePath), "a.txt", "b.txt")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx = jobs.WithReporter(ctx, func(p jobs.TransferProgress) error {
		if p.BytesDone > 0 {
			cancel()
			return context.Canceled
		}
		return nil
	})
	err := s.Execute(ctx, req)
	if !errors.Is(err, context.Canceled) || !strings.Contains(err.Error(), "保留部分") {
		t.Fatalf("cancel error: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "output")); err != nil {
		t.Fatal(err)
	}
}

func TestSandboxDeniesWrites(t *testing.T) {
	file := filepath.Join(t.TempDir(), "escape")
	exe, _ := os.Executable()
	cmd := exec.Command(exe, helperArgument, "/bin/sh", "-c", "touch \"$1\"", "sh", file)
	if err := cmd.Run(); err == nil {
		t.Fatal("sandbox allowed write")
	}
	if _, err := os.Stat(file); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("outside file exists: %v", err)
	}
}

func TestEntryValidation(t *testing.T) {
	for _, items := range [][]entry{
		{{name: "a"}, {name: "a"}}, {{name: "a"}, {name: "a/b"}}, {{name: "bad\nname"}}, {{name: "large", size: maxBytes + 1}},
	} {
		if _, err := validateEntries(items); err == nil {
			t.Fatalf("accepted %+v", items)
		}
	}
}

func TestTarXZStream(t *testing.T) {
	s, req, dir := fixture(t, "bundle.tar.xz")
	var raw bytes.Buffer
	tw := tar.NewWriter(&raw)
	if err := tw.WriteHeader(&tar.Header{Name: "a.txt", Mode: 0644, Size: 5}); err != nil {
		t.Fatal(err)
	}
	_, _ = tw.Write([]byte("hello"))
	_ = tw.Close()
	if err := os.WriteFile(filepath.Join(dir, "bundle.tar"), raw.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	tool, _ := findTool()
	cmd := exec.Command(tool, "a", "-txz", filepath.Join(dir, req.SourcePath), filepath.Join(dir, "bundle.tar"))
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%s %v", output, err)
	}
	_ = os.Remove(filepath.Join(dir, "bundle.tar"))
	if err := s.Execute(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "output/a.txt"))
	if err != nil || string(data) != "hello" {
		t.Fatalf("%q %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "output/bundle.tar")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("intermediate file exists: %v", err)
	}
}

func TestSourceAndDestinationCannotEscapeRoots(t *testing.T) {
	s, req, dir := fixture(t, "source.zip")
	zipFixture(t, filepath.Join(dir, req.SourcePath), "a.txt")
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "redirect")); err != nil {
		t.Fatal(err)
	}
	req.DestPath = "redirect"
	if err := s.Execute(context.Background(), req); err == nil {
		t.Fatal("outside destination accepted")
	}
	req.DestPath, req.SourcePath = ".", "../escape.zip"
	if err := s.Execute(context.Background(), req); err == nil {
		t.Fatal("outside source accepted")
	}
}

func TestSafeWriterRejectsRacedSymlink(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "a.txt"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := os.Symlink(outside, filepath.Join(dir, "nested")); err != nil {
		t.Fatal(err)
	}
	done := 0
	progress := jobs.TransferProgress{FilesDone: &done}
	err = writeEntry(context.Background(), root, entry{name: "nested/a.txt", size: 5}, &progress, func(w io.Writer) error { _, err := w.Write([]byte("wrong")); return err })
	if err == nil {
		t.Fatal("symlink escape accepted")
	}
	data, err := os.ReadFile(filepath.Join(outside, "a.txt"))
	if err != nil || string(data) != "original" {
		t.Fatalf("outside modified: %q %v", data, err)
	}
}

func TestMissingTool(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if _, err := findTool(); err == nil || !strings.Contains(err.Error(), "安装") {
		t.Fatalf("missing tool: %v", err)
	}
}

func TestMergerfsExtract(t *testing.T) {
	mount := os.Getenv("FILEBUTLER_TEST_FUSE_ROOT")
	if mount == "" {
		t.Skip("dedicated mergerfs test mount not configured")
	}
	dir, err := os.MkdirTemp(mount, "extract-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	s := Service{Roots: roots.NewResolver([]roots.Root{{ID: "fuse", Path: dir}})}
	req := Request{SourceRoot: "fuse", SourcePath: "photos.zip", DestRoot: "fuse", DestPath: ".", Name: "photos"}
	zipFixture(t, filepath.Join(dir, "photos.zip"), "相册/001.txt", "002.txt")
	for _, name := range []string{"photos", ""} {
		req.Name = name
		if err := s.Execute(context.Background(), req); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(filepath.Join(dir, name, "相册/001.txt"))
		if err != nil || string(data) != "hello 相册/001.txt" {
			t.Fatalf("%q %v", data, err)
		}
	}
}

func TestWriteFailureRetainsUnderlyingError(t *testing.T) {
	f, err := os.OpenFile("/dev/full", os.O_WRONLY, 0)
	if err != nil {
		t.Skip(err)
	}
	defer f.Close()
	w := &streamWriter{ctx: context.Background(), file: f, remaining: 5, progress: &jobs.TransferProgress{}}
	if _, err := w.Write([]byte("hello")); !errors.Is(err, syscall.ENOSPC) {
		t.Fatalf("disk full: %v", err)
	}
}
