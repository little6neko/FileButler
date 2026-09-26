package superrename

import (
	"context"
	"crypto/sha1"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/little6neko/filebutler/internal/details"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestSuperRenameKeepsHashesThroughSwapsVideoMovesAndRollback(t *testing.T) {
	for _, rollback := range []bool{false, true} {
		t.Run(fmt.Sprint("rollback=", rollback), func(t *testing.T) {
			root := t.TempDir()
			files := map[string]string{"A/01.jpg": "first", "A/02.jpg": "second", "A/clip.mp4": "video", "A/keep.txt": "untouched"}
			db, err := storage.Open(filepath.Join(t.TempDir(), "db"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			for path, content := range files {
				testutil.WriteFile(t, filepath.Join(root, path), content)
				info, _ := os.Stat(filepath.Join(root, path))
				err := db.PutHash(context.Background(), storage.Hash{Scope: storage.LocalScope("a", root), Path: path, Version: storage.LocalVersion(info), SHA1: fmt.Sprintf("%X", sha1.Sum([]byte(content))), Origin: "local"})
				if err != nil {
					t.Fatal(err)
				}
			}
			resolver := roots.NewResolver([]roots.Root{{ID: "a", Path: root}})
			group := PlanGroup{Path: "A", Name: "A", CreateVideoDirectory: true, Items: []PlanItem{
				{SourcePath: "A/01.jpg", TargetPath: "A/02.jpg", MediaKind: MediaKindImage, Changed: true},
				{SourcePath: "A/02.jpg", TargetPath: "A/01.jpg", MediaKind: MediaKindImage, Changed: true},
				{SourcePath: "A/clip.mp4", TargetPath: "A/视频/V01.mp4", MediaKind: MediaKindVideo, Changed: true},
			}}
			fs := &faultingExecutorFileSystem{executorFileSystem: osExecutorFileSystem{}}
			injected := errors.New("video finalize failed")
			failed := false
			fs.rename = func(src, dst string) error {
				if rollback && !failed && strings.HasSuffix(dst, "V01.mp4") {
					failed = true
					return injected
				}
				return os.Rename(src, dst)
			}
			err = (Executor{Resolver: resolver, Cache: db, fileSystem: fs}).ExecuteGroup(context.Background(), "hashes", "a", group)
			if rollback && !errors.Is(err, injected) || !rollback && err != nil {
				t.Fatal(err)
			}
			want := files
			if !rollback {
				want = map[string]string{"A/01.jpg": "second", "A/02.jpg": "first", "A/视频/V01.mp4": "video", "A/keep.txt": "untouched"}
			}
			service := details.Service{Roots: resolver, DB: db}
			for path, content := range want {
				items, err := service.Basic(context.Background(), details.Request{RootID: "a", Paths: []string{path}})
				digest := fmt.Sprintf("%X", sha1.Sum([]byte(content)))
				if err != nil || len(items) != 1 || items[0].SHA1 != digest {
					t.Fatalf("%s: %+v %v, want %s", path, items, err, digest)
				}
			}
			var count int
			if err := db.DB.QueryRow("SELECT count(*) FROM file_hashes").Scan(&count); err != nil || count != len(files) {
				t.Fatalf("hashes=%d err=%v", count, err)
			}
			assertNoRecoveryResidue(t, filepath.Join(root, "A"))
		})
	}
}
