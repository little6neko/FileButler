package storage_test

import (
	"context"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/ops"
	"github.com/little6neko/filebutler/internal/rename"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
	"github.com/little6neko/filebutler/internal/textfile"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalMutationsInvalidateCache(t *testing.T) {
	for _, action := range []string{"rename", "move", "delete", "edit"} {
		t.Run(action, func(t *testing.T) {
			ctx := context.Background()
			a, b := t.TempDir(), t.TempDir()
			os.Mkdir(filepath.Join(a, "dir"), 0755)
			os.WriteFile(filepath.Join(a, "dir", "a.txt"), []byte("before"), 0644)
			resolver := roots.NewResolver([]roots.Root{{ID: "a", Path: a}, {ID: "b", Path: b}})
			db, err := storage.Open(filepath.Join(t.TempDir(), "fb.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			h := storage.Hash{Scope: storage.LocalScope("a", a), Path: "dir/a.txt", Version: "v1", SHA1: strings.Repeat("a", 40), Origin: "local"}
			if err := db.PutHash(ctx, h); err != nil {
				t.Fatal(err)
			}
			switch action {
			case "rename":
				err = (rename.Executor{Resolver: resolver, Cache: db}).ExecuteItem(ctx, jobs.ExecutableItem{SourceRoot: "a", SourcePath: "dir", DestRoot: "a", DestPath: "renamed"})
			case "move":
				err = (ops.Executor{Resolver: resolver, Cache: db}).Execute(ctx, ops.PlanItem{Operation: ops.OpMove, SourceRoot: "a", SourcePath: "dir", DestRoot: "b", DestPath: "dir"})
			case "delete":
				err = (ops.Executor{Resolver: resolver, Cache: db}).Execute(ctx, ops.PlanItem{Operation: ops.OpDelete, SourceRoot: "a", SourcePath: "dir"})
			case "edit":
				s := textfile.NewService(resolver)
				s.Cache = db
				doc, e := s.Read("a", "dir/a.txt")
				if e != nil {
					t.Fatal(e)
				}
				_, err = s.Save(textfile.SaveRequest{RootID: "a", Path: "dir/a.txt", Content: "after", Encoding: doc.Encoding, LineEnding: doc.PreferredLineEnding, Revision: doc.Revision})
			}
			if err != nil {
				t.Fatal(err)
			}
			if got, err := db.Hash(ctx, h); err != nil || got != "" {
				t.Fatal("mutation left stale hash")
			}
		})
	}
}
