package storage

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "private", "fb.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func TestPersistencePermissionsAndNoLegacyImport(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.CreateAdmin(ctx, Admin{Username: "admin", PasswordHash: "test-hash", SigningKey: make([]byte, 32)}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetCookie(ctx, "UID=1; CID=test"); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		info, err := os.Stat(s.Path + suffix)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0600 {
			t.Fatalf("insecure permissions %s %o", suffix, info.Mode().Perm())
		}
	}
	path := s.Path
	s.Close()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a, err := s.Admin(ctx)
	if err != nil || a == nil || a.Username != "admin" {
		t.Fatal("administrator not persisted")
	}
	if cookie, err := s.Cookie(ctx, "1"); err != nil || cookie != "UID=1; CID=test" {
		t.Fatal("cookie not persisted")
	}
	if err := s.DeleteCookie(ctx, "1"); err != nil {
		t.Fatal(err)
	}
	if cookie, err := s.Cookie(ctx, "1"); err != nil || cookie != "" {
		t.Fatal("logout did not delete cookie")
	}
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "auth.json"), []byte(`{"username":"old"}`), 0600)
	os.WriteFile(filepath.Join(dir, "115-cookies.txt"), []byte("UID=old"), 0600)
	fresh, err := Open(filepath.Join(dir, "fb.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	if a, err := fresh.Admin(ctx); err != nil || a != nil {
		t.Fatal("legacy authentication imported")
	}
	if c, err := fresh.Cookie(ctx, "1"); err != nil || c != "" {
		t.Fatal("legacy cookie imported")
	}
}
func TestInvalidDatabasesFailClosed(t *testing.T) {
	for _, body := range []string{"not sqlite", `{"username":"admin"}`} {
		path := filepath.Join(t.TempDir(), "fb.db")
		os.WriteFile(path, []byte(body), 0600)
		if s, err := Open(path); err == nil {
			s.Close()
			t.Fatal("invalid database accepted")
		}
		after, _ := os.ReadFile(path)
		if string(after) != body {
			t.Fatal("invalid database overwritten")
		}
	}
	for _, version := range []int{0, 1, 99} {
		path := filepath.Join(t.TempDir(), "fb.db")
		db, err := sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		db.Exec(fmt.Sprintf("CREATE TABLE unrelated(id INTEGER); PRAGMA user_version=%d", version))
		db.Close()
		if s, err := Open(path); err == nil {
			s.Close()
			t.Fatal("unknown schema accepted")
		}
	}
}

func TestMultipleAccountsPersistIndependently(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for _, cookie := range []string{"UID=1; CID=old", "UID=2; CID=other", "UID=1; CID=new"} {
		if err := s.SetCookie(ctx, cookie); err != nil {
			t.Fatal(err)
		}
	}
	used, total := int64(100), int64(200)
	a := CloudAccount{AccountID: "1", Name: "first", Avatar: "https://example.com/avatar", UsedBytes: &used, TotalBytes: &total}
	if err := s.UpdateAccount(ctx, a, "UID=1; CID=new"); err != nil {
		t.Fatal(err)
	}
	a.Name = "stale"
	if err := s.UpdateAccount(ctx, a, "UID=1; CID=old"); err != nil {
		t.Fatal(err)
	}
	accounts, err := s.Accounts(ctx)
	if err != nil || len(accounts) != 2 || accounts[0].Name != "first" || *accounts[0].UsedBytes != used {
		t.Fatalf("unexpected accounts: %+v %v", accounts, err)
	}
	if cookie, err := s.Cookie(ctx, ""); err != nil || cookie != "" {
		t.Fatal("missing account selected an implicit default")
	}
	if err := s.DeleteCookie(ctx, "1"); err != nil {
		t.Fatal(err)
	}
	if cookie, err := s.Cookie(ctx, "2"); err != nil || cookie != "UID=2; CID=other" {
		t.Fatal("logout affected another account")
	}
	accounts, err = s.Accounts(ctx)
	if err != nil || len(accounts) != 1 || accounts[0].AccountID != "2" {
		t.Fatal("wrong remaining account")
	}
}
func TestConcurrentAdminAndCacheWrites(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	out := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out <- s.CreateAdmin(ctx, Admin{Username: "admin", PasswordHash: "hash", SigningKey: make([]byte, 32)})
		}()
	}
	wg.Wait()
	close(out)
	success := 0
	for err := range out {
		if err == nil {
			success++
		} else if err != ErrInitialized {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("%d initializations", success)
	}
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h := Hash{Scope: "115:7", Path: fmt.Sprint(i), Version: "v1", SHA1: strings.Repeat("a", 40), Origin: "115"}
			if err := s.PutHash(ctx, h); err != nil {
				t.Error(err)
			}
			if got, err := s.Hash(ctx, h); err != nil || got != strings.Repeat("A", 40) {
				t.Error("cache lost a concurrent write")
			}
		}()
	}
	wg.Wait()
}
func TestHashVersionAndDirectoryInvalidation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	h := Hash{Scope: "local:a:/mnt/a", Path: "目录%_/a.txt", Version: "v1", SHA1: strings.Repeat("1", 40), Origin: "local"}
	for _, p := range []string{h.Path, "目录%_/nested/b.txt", "目录-other/a.txt"} {
		v := h
		v.Path = p
		if err := s.PutHash(ctx, v); err != nil {
			t.Fatal(err)
		}
	}
	stale := h
	stale.Version = "v2"
	if v, err := s.Hash(ctx, stale); err != nil || v != "" {
		t.Fatal("stale cache hit")
	}
	if err := s.Invalidate(ctx, h.Scope, "目录%_"); err != nil {
		t.Fatal(err)
	}
	var n int
	s.DB.QueryRow("SELECT count(*) FROM file_hashes").Scan(&n)
	if n != 1 {
		t.Fatalf("prefix matching deleted wrong entries: %d", n)
	}
	h.Path = "目录-other/a.txt"
	h.Scope = "local:a:/mnt/new"
	if v, _ := s.Hash(ctx, h); v != "" {
		t.Fatal("root mapping cache collision")
	}
	h.SHA1 = "invalid"
	if s.PutHash(ctx, h) == nil {
		t.Fatal("invalid SHA1 accepted")
	}
}
