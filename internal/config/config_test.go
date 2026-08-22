package config

import (
	"os"
	"path/filepath"
	"testing"
)

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
auth_file: "./auth.json"
job_concurrency: 2
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
	if cfg.AuthFile != filepath.Join(dir, "auth.json") {
		t.Fatalf("auth file = %q", cfg.AuthFile)
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
auth_file: "./auth.json"
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

func TestLoadConfigDefaultsAuthenticationFileRelativeToConfig(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "data")
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
	if cfg.AuthFile != filepath.Join(dir, "data", "auth.json") {
		t.Fatalf("auth file = %q", cfg.AuthFile)
	}
}
