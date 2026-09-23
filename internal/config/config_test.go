package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadConfigRejectsRemovedJobConcurrency(t *testing.T) {
	path := filepath.Join(t.TempDir(), "filebutler.yaml")
	if err := os.WriteFile(path, []byte("job_concurrency: 2\n"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := Load(path)
	if err == nil || !strings.Contains(err.Error(), "field job_concurrency not found") {
		t.Fatalf("expected removed field error, got %v", err)
	}
}

func TestRejectPrivateDatabaseUnderPublicDirectoriesAndUnknownConfig(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "files")
	os.Mkdir(root, 0755)
	for _, extra := range []string{"database_file: \"" + filepath.Join(root, "private", "fb.db") + "\"\n", "auth_file: old.json\n", "cloud115:\n  credentials: old.txt\n"} {
		cfg := filepath.Join(dir, "fb.yaml")
		body := extra + fmt.Sprintf("roots:\n  - id: files\n    path: %q\n", root)
		os.WriteFile(cfg, []byte(body), 0600)
		if _, err := Load(cfg); err == nil {
			t.Fatal("unsafe or obsolete configuration accepted")
		}
	}
}

func TestLoadConfigValidatesAndAbsolutizesRoots(t *testing.T) {
	dir := t.TempDir()
	rootA := filepath.Join(dir, "data-a")
	rootB := filepath.Join(dir, "data-b")
	if err := os.Mkdir(rootA, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(rootB, 0o755); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(dir, "filebutler.yaml")
	body := []byte(`
listen: "127.0.0.1:8080"
database_file: "./filebutler.db"
log_level: "debug"
session:
  cookie_name: "filebutler_session"
  secure: false
roots:
  - id: "downloads"
    name: "Downloads"
    path: "` + rootA + `"
  - id: "media"
    name: "Media"
    path: "` + rootB + `"
`)
	if err := os.WriteFile(configPath, body, 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Listen != "127.0.0.1:8080" {
		t.Fatalf("listen = %q", cfg.Listen)
	}
	if len(cfg.Roots) != 2 {
		t.Fatalf("roots length = %d", len(cfg.Roots))
	}
	if cfg.DatabaseFile != filepath.Join(dir, "filebutler.db") {
		t.Fatalf("auth file = %q", cfg.DatabaseFile)
	}
}

func TestLoadConfigRejectsDuplicateRootIDs(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "data")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(dir, "filebutler.yaml")
	body := []byte(`
database_file: "./filebutler.db"
roots:
  - id: "data"
    name: "Data A"
    path: "` + root + `"
  - id: "data"
    name: "Data B"
    path: "` + root + `"
`)
	if err := os.WriteFile(configPath, body, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := Load(configPath)
	if err == nil {
		t.Fatal("expected duplicate root id error")
	}
}

func TestLoadConfigDefaultsDatabaseFileRelativeToConfig(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "files")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(dir, "filebutler.yaml")
	body := []byte(`
roots:
  - id: "data"
    path: "` + root + `"
`)
	if err := os.WriteFile(configPath, body, 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseFile != filepath.Join(dir, "data", "filebutler.db") {
		t.Fatalf("auth file = %q", cfg.DatabaseFile)
	}
}
