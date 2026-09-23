package cloud115

import (
	"context"
	"encoding/json"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPrivateStorageScopesAndAllowlist(t *testing.T) {
	root := t.TempDir()
	db, err := storage.Open(filepath.Join(t.TempDir(), "fb.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	b := NewBridge("", "", db, roots.NewResolver([]roots.Root{{ID: "a", Path: root}}))
	ctx := context.Background()
	call := func(method string, params any) (any, error) {
		raw, _ := json.Marshal(params)
		return b.storageCall(ctx, method, raw)
	}
	h := map[string]string{"path": filepath.Join(root, "a.txt"), "version": "one", "sha1": strings.Repeat("a", 40), "origin": "local"}
	if _, err := call("hash.put", h); err != nil {
		t.Fatal(err)
	}
	if value, err := call("hash.get", h); err != nil || value != strings.Repeat("A", 40) {
		t.Fatal("missing cached hash")
	}
	h["path"] = filepath.Join(root, "..", "escape")
	if _, err := call("hash.put", h); err == nil {
		t.Fatal("unmapped path accepted")
	}
	if _, err := call("sql.execute", map[string]string{"sql": "DELETE FROM users"}); err == nil {
		t.Fatal("unrestricted operation accepted")
	}
}

func TestConcurrentPrivateStorageProtocolAndRestart(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python unavailable")
	}
	db, err := storage.Open(filepath.Join(t.TempDir(), "fb.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.SetCookie(context.Background(), "UID=7; CID=test"); err != nil {
		t.Fatal(err)
	}
	script, _ := filepath.Abs("testdata/storage_worker.py")
	b := NewBridge(python, script, db, roots.NewResolver(nil))
	defer b.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			data, err := b.Call(ctx, "status", nil, nil)
			if err != nil || !strings.Contains(string(data), `"ok": true`) {
				t.Error("private response misrouted", err)
			}
		}()
	}
	wg.Wait()
	b.Close()
	time.Sleep(30 * time.Millisecond)
	if _, err := b.Call(ctx, "status", nil, nil); err != nil {
		t.Fatal(err)
	}
}

func TestInstalledProviderCredentialRoundtrip(t *testing.T) {
	python := os.Getenv("FILEBUTLER_TEST_PYTHON")
	if python == "" {
		t.Skip("provider environment required")
	}
	db, err := storage.Open(filepath.Join(t.TempDir(), "fb.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	script, _ := filepath.Abs("../../cloud115/worker.py")
	b := NewBridge(python, script, db, roots.NewResolver(nil))
	defer b.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.SetCookie(ctx, "UID=7; CID=test"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Call(ctx, "logout", map[string]string{"accountId": "7"}, nil); err != nil {
		t.Fatal(err)
	}
	if cookie, err := db.Cookie(ctx, "7"); err != nil || cookie != "" {
		t.Fatal("worker logout did not clear database")
	}
}
