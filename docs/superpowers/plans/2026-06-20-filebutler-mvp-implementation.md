# FileButler MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first FileButler release: a Linux/Docker self-hosted dual-pane file manager with administrator login, safe root-bounded file operations, PowerRename-style batch rename, job tracking, SQLite persistence, and a React UI.

**Architecture:** A Go HTTP server hosts REST APIs and built React assets. Backend modules are split by auth, config, roots, browser, rename, ops, jobs, audit, and web routing. SQLite stores accounts, sessions, jobs, item results, audit records, and undo metadata; configuration owns storage roots.

**Tech Stack:** Go 1.26+, chi router, `modernc.org/sqlite`, `golang.org/x/crypto/argon2`, YAML config, React/Vite/TypeScript, Vitest, Playwright, Docker.

---

## Scope Check

This plan implements the complete first release described in `docs/superpowers/specs/2026-06-20-filebutler-design.md`. The feature spans backend, frontend, and deployment, but the subsystems are tightly coupled around one runnable MVP. Keep each task independently testable and commit after every task.

Resolved implementation choices:

- Router: `github.com/go-chi/chi/v5`.
- SQLite driver: `modernc.org/sqlite` to avoid CGO.
- Migrations: embedded SQL migrations in Go, applied at startup.
- Password hashing: Argon2id encoded as `$argon2id$v=19$m=65536,t=3,p=2$...`.
- Job progress: polling endpoints first.
- Frontend UI: custom React components and CSS, no component library in the first release.
- Conflict policy: conservative no-overwrite behavior in the first release.
- Regex engine: Go RE2 syntax via `regexp`, with `$1`-style capture expansion.

## Target File Structure

Create this structure during the implementation:

```text
cmd/filebutler/main.go
configs/filebutler.example.yaml
internal/audit/audit.go
internal/auth/auth.go
internal/auth/handlers.go
internal/auth/password.go
internal/auth/session.go
internal/browser/browser.go
internal/config/config.go
internal/jobs/handlers.go
internal/jobs/runner.go
internal/jobs/store.go
internal/jobs/types.go
internal/natsort/natsort.go
internal/ops/executor.go
internal/ops/planner.go
internal/ops/types.go
internal/rename/planner.go
internal/rename/types.go
internal/roots/roots.go
internal/store/migrations.go
internal/store/store.go
internal/testutil/db.go
internal/testutil/fs.go
internal/web/errors.go
internal/web/respond.go
internal/web/router.go
internal/web/static.go
web/index.html
web/package.json
web/src/api/client.ts
web/src/api/types.ts
web/src/App.tsx
web/src/main.tsx
web/src/styles.css
web/src/components/DualPane.tsx
web/src/components/FilePane.tsx
web/src/components/InitScreen.tsx
web/src/components/LoginScreen.tsx
web/src/components/OperationPreview.tsx
web/src/components/RenameDialog.tsx
web/src/components/JobsPanel.tsx
web/src/components/ErrorBanner.tsx
web/src/test/setup.ts
Dockerfile
.dockerignore
README.md
```

Backend tests live beside backend packages as `*_test.go`. Frontend tests live beside React components as `*.test.tsx`.

---

### Task 1: Backend Scaffold, Config Loading, And Health Endpoint

**Files:**
- Create: `go.mod`
- Create: `cmd/filebutler/main.go`
- Create: `configs/filebutler.example.yaml`
- Create: `internal/config/config.go`
- Test: `internal/config/config_test.go`

- [ ] **Step 1: Initialize the Go module and add base dependencies**

Run:

```bash
go mod init github.com/little6neko/filebutler
go get github.com/go-chi/chi/v5 gopkg.in/yaml.v3
```

Expected: `go.mod` and `go.sum` exist, and `go test ./...` can discover an empty module without package errors.

- [ ] **Step 2: Write config loading tests**

Create `internal/config/config_test.go` with these test cases:

```go
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
database_path: "./filebutler.db"
job_concurrency: 2
log_level: "debug"
session:
  cookie_name: "filebutler_session"
  secure: false
  max_age_seconds: 3600
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
	if !filepath.IsAbs(cfg.DatabasePath) {
		t.Fatalf("database path is not absolute: %q", cfg.DatabasePath)
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
database_path: "./filebutler.db"
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
```

- [ ] **Step 3: Run the config tests and verify they fail**

Run:

```bash
go test ./internal/config -run TestLoadConfig -v
```

Expected: FAIL because `Load` and config types do not exist.

- [ ] **Step 4: Implement config loading**

Create `internal/config/config.go` with:

```go
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Listen         string        `yaml:"listen"`
	DatabasePath   string        `yaml:"database_path"`
	JobConcurrency int           `yaml:"job_concurrency"`
	LogLevel       string        `yaml:"log_level"`
	Session        SessionConfig `yaml:"session"`
	Roots          []RootConfig  `yaml:"roots"`
}

type SessionConfig struct {
	CookieName    string `yaml:"cookie_name"`
	Secure        bool   `yaml:"secure"`
	MaxAgeSeconds int    `yaml:"max_age_seconds"`
}

type RootConfig struct {
	ID   string `yaml:"id"`
	Name string `yaml:"name"`
	Path string `yaml:"path"`
}

func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	applyDefaults(&cfg)
	baseDir := filepath.Dir(path)
	if !filepath.IsAbs(cfg.DatabasePath) {
		cfg.DatabasePath = filepath.Join(baseDir, cfg.DatabasePath)
	}
	absDB, err := filepath.Abs(cfg.DatabasePath)
	if err != nil {
		return Config{}, err
	}
	cfg.DatabasePath = absDB
	seen := map[string]struct{}{}
	for i := range cfg.Roots {
		root := &cfg.Roots[i]
		root.ID = strings.TrimSpace(root.ID)
		root.Name = strings.TrimSpace(root.Name)
		if root.ID == "" {
			return Config{}, fmt.Errorf("root %d has empty id", i)
		}
		if _, ok := seen[root.ID]; ok {
			return Config{}, fmt.Errorf("duplicate root id %q", root.ID)
		}
		seen[root.ID] = struct{}{}
		if root.Name == "" {
			root.Name = root.ID
		}
		if root.Path == "" {
			return Config{}, fmt.Errorf("root %q has empty path", root.ID)
		}
		absRoot, err := filepath.Abs(root.Path)
		if err != nil {
			return Config{}, err
		}
		info, err := os.Stat(absRoot)
		if err != nil {
			return Config{}, fmt.Errorf("root %q path: %w", root.ID, err)
		}
		if !info.IsDir() {
			return Config{}, fmt.Errorf("root %q path is not a directory", root.ID)
		}
		root.Path = absRoot
	}
	if len(cfg.Roots) == 0 {
		return Config{}, errors.New("at least one root is required")
	}
	return cfg, nil
}

func applyDefaults(cfg *Config) {
	if cfg.Listen == "" {
		cfg.Listen = "127.0.0.1:8080"
	}
	if cfg.DatabasePath == "" {
		cfg.DatabasePath = "./filebutler.db"
	}
	if cfg.JobConcurrency <= 0 {
		cfg.JobConcurrency = 1
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}
	if cfg.Session.CookieName == "" {
		cfg.Session.CookieName = "filebutler_session"
	}
	if cfg.Session.MaxAgeSeconds <= 0 {
		cfg.Session.MaxAgeSeconds = int((24 * time.Hour).Seconds())
	}
}
```

- [ ] **Step 5: Add example config and minimal server**

Create `configs/filebutler.example.yaml`:

```yaml
listen: "127.0.0.1:8080"
database_path: "./data/filebutler.db"
job_concurrency: 2
log_level: "info"
session:
  cookie_name: "filebutler_session"
  secure: false
  max_age_seconds: 86400
roots:
  - id: "downloads"
    name: "Downloads"
    path: "/data/downloads"
  - id: "media"
    name: "Media"
    path: "/data/media"
```

Create `cmd/filebutler/main.go`:

```go
package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/config"
)

func main() {
	configPath := flag.String("config", "configs/filebutler.example.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	r := chi.NewRouter()
	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	log.Printf("FileButler listening on %s", cfg.Listen)
	if err := http.ListenAndServe(cfg.Listen, r); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
gofmt -w cmd internal
go test ./...
git add go.mod go.sum cmd internal configs
git commit -m "feat: scaffold backend config"
```

Expected: tests pass and the commit succeeds.

---

### Task 2: SQLite Store And Embedded Migrations

**Files:**
- Create: `internal/store/store.go`
- Create: `internal/store/migrations.go`
- Create: `internal/testutil/db.go`
- Test: `internal/store/store_test.go`

- [ ] **Step 1: Add SQLite dependency**

Run:

```bash
go get modernc.org/sqlite
```

Expected: `go.mod` includes `modernc.org/sqlite`.

- [ ] **Step 2: Write migration tests**

Create `internal/store/store_test.go`:

```go
package store

import (
	"context"
	"database/sql"
	"testing"
)

func TestOpenAppliesMigrations(t *testing.T) {
	db, err := Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer db.Close()

	rows, err := db.QueryContext(context.Background(), `select name from sqlite_master where type = 'table'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	tables := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables[name] = true
	}
	for _, name := range []string{"schema_migrations", "users", "sessions", "jobs", "job_items", "audit_records"} {
		if !tables[name] {
			t.Fatalf("missing table %s; tables=%v", name, tables)
		}
	}
}

func TestMigrationsAreIdempotent(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if err := ApplyMigrations(context.Background(), db); err != nil {
		t.Fatalf("first ApplyMigrations: %v", err)
	}
	if err := ApplyMigrations(context.Background(), db); err != nil {
		t.Fatalf("second ApplyMigrations: %v", err)
	}
}
```

- [ ] **Step 3: Run the tests and verify they fail**

Run:

```bash
go test ./internal/store -run Test -v
```

Expected: FAIL because `Open` and `ApplyMigrations` do not exist.

- [ ] **Step 4: Implement store opening and migrations**

Create `internal/store/store.go`:

```go
package store

import (
	"context"
	"database/sql"

	_ "modernc.org/sqlite"
)

func Open(ctx context.Context, path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys = ON`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := ApplyMigrations(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}
```

Create `internal/store/migrations.go` with migrations for these tables:

```go
package store

import (
	"context"
	"database/sql"
	"fmt"
)

type migration struct {
	Version int
	SQL     string
}

var migrations = []migration{
	{Version: 1, SQL: `
create table if not exists schema_migrations (
  version integer primary key,
  applied_at text not null default current_timestamp
);
create table if not exists users (
  id integer primary key autoincrement,
  username text not null unique,
  password_hash text not null,
  created_at text not null default current_timestamp
);
create table if not exists sessions (
  id text primary key,
  user_id integer not null references users(id) on delete cascade,
  expires_at text not null,
  created_at text not null default current_timestamp
);
create table if not exists jobs (
  id text primary key,
  type text not null,
  status text not null,
  actor_id integer not null references users(id),
  source_root_id text not null,
  dest_root_id text,
  plan_json text not null,
  root_snapshot_json text not null,
  progress_total integer not null default 0,
  progress_done integer not null default 0,
  cancel_requested integer not null default 0,
  error_message text not null default '',
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  finished_at text
);
create table if not exists job_items (
  job_id text not null references jobs(id) on delete cascade,
  item_index integer not null,
  source_path text not null,
  dest_path text,
  status text not null,
  error_code text not null default '',
  error_message text not null default '',
  undo_json text not null default '{}',
  primary key (job_id, item_index)
);
create table if not exists audit_records (
  id integer primary key autoincrement,
  actor_id integer not null references users(id),
  action text not null,
  source_root_id text not null,
  source_path text not null,
  dest_root_id text,
  dest_path text,
  job_id text,
  detail_json text not null default '{}',
  created_at text not null default current_timestamp
);
`},
}

func ApplyMigrations(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `create table if not exists schema_migrations (version integer primary key, applied_at text not null default current_timestamp)`); err != nil {
		return err
	}
	for _, m := range migrations {
		var exists int
		err := db.QueryRowContext(ctx, `select count(1) from schema_migrations where version = ?`, m.Version).Scan(&exists)
		if err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, m.SQL); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %d: %w", m.Version, err)
		}
		if _, err := tx.ExecContext(ctx, `insert into schema_migrations(version) values (?)`, m.Version); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 5: Add DB test helper**

Create `internal/testutil/db.go`:

```go
package testutil

import (
	"context"
	"database/sql"
	"testing"

	"github.com/little6neko/filebutler/internal/store"
)

func OpenTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
gofmt -w internal
go test ./...
git add go.mod go.sum internal/store internal/testutil
git commit -m "feat: add sqlite store migrations"
```

Expected: tests pass and the commit succeeds.

---

### Task 3: Authentication, First-Run Admin, And Sessions

**Files:**
- Create: `internal/auth/password.go`
- Create: `internal/auth/auth.go`
- Create: `internal/auth/session.go`
- Create: `internal/auth/handlers.go`
- Test: `internal/auth/password_test.go`
- Test: `internal/auth/auth_test.go`

- [ ] **Step 1: Add crypto dependency**

Run:

```bash
go get golang.org/x/crypto/argon2
```

- [ ] **Step 2: Write password tests**

Create `internal/auth/password_test.go`:

```go
package auth

import "testing"

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if hash == "correct horse battery staple" {
		t.Fatal("hash stored plaintext password")
	}
	if !VerifyPassword(hash, "correct horse battery staple") {
		t.Fatal("VerifyPassword rejected correct password")
	}
	if VerifyPassword(hash, "wrong password") {
		t.Fatal("VerifyPassword accepted wrong password")
	}
}
```

- [ ] **Step 3: Write account and session tests**

Create `internal/auth/auth_test.go` with tests for:

```go
func TestInitStatusAndCreateAdmin(t *testing.T)
func TestCreateAdminOnlyOnce(t *testing.T)
func TestLoginCreatesSession(t *testing.T)
func TestSessionLookupRejectsExpiredSession(t *testing.T)
```

Use `testutil.OpenTestDB(t)`, create a `Service`, call `NeedsInitialization`, `CreateAdmin`, `Login`, and `LookupSession`.

- [ ] **Step 4: Run tests and verify they fail**

Run:

```bash
go test ./internal/auth -run Test -v
```

Expected: FAIL because auth service and password functions do not exist.

- [ ] **Step 5: Implement password hashing**

Create `internal/auth/password.go` with:

```go
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argonMemory      = 64 * 1024
	argonIterations  = 3
	argonParallelism = 2
	argonSaltLength  = 16
	argonKeyLength   = 32
)

func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory,
		argonIterations,
		argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

func VerifyPassword(encoded string, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory uint32
	var iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
```

- [ ] **Step 6: Implement auth service and session methods**

Create `internal/auth/auth.go` and `internal/auth/session.go` with:

```go
type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type Service struct {
	DB            *sql.DB
	SessionMaxAge time.Duration
}

func (s Service) NeedsInitialization(ctx context.Context) (bool, error)
func (s Service) CreateAdmin(ctx context.Context, username, password string) (User, error)
func (s Service) Login(ctx context.Context, username, password string) (string, User, error)
func (s Service) LookupSession(ctx context.Context, sessionID string) (User, error)
func (s Service) DeleteSession(ctx context.Context, sessionID string) error
```

Implementation requirements:

- Trim username and reject empty username.
- Reject passwords shorter than 10 characters.
- `CreateAdmin` must fail if any user already exists.
- Session ids must use 32 random bytes encoded with `base64.RawURLEncoding`.
- `LookupSession` must reject expired sessions and delete them.

- [ ] **Step 7: Implement auth HTTP handlers**

Create `internal/auth/handlers.go` with handlers:

```go
func InitStatusHandler(service Service) http.HandlerFunc
func CreateAdminHandler(service Service) http.HandlerFunc
func LoginHandler(service Service, cookieName string, secure bool) http.HandlerFunc
func LogoutHandler(service Service, cookieName string) http.HandlerFunc
func MeHandler(service Service, cookieName string) http.HandlerFunc
func RequireAuth(service Service, cookieName string) func(http.Handler) http.Handler
```

All JSON responses use this shape:

```json
{"data": {...}}
```

All errors use this shape:

```json
{"error": {"code": "invalid_request", "message": "human readable message"}}
```

- [ ] **Step 8: Run tests and commit**

Run:

```bash
gofmt -w internal/auth
go test ./internal/auth ./internal/store
git add go.mod go.sum internal/auth
git commit -m "feat: add admin authentication"
```

Expected: tests pass and the commit succeeds.

---

### Task 4: Storage Roots And Boundary-Safe Path Resolution

**Files:**
- Create: `internal/roots/roots.go`
- Create: `internal/testutil/fs.go`
- Test: `internal/roots/roots_test.go`

- [ ] **Step 1: Write root resolution tests**

Create `internal/roots/roots_test.go` with tests for:

```go
func TestResolveAllowsRelativePathInsideRoot(t *testing.T)
func TestResolveRejectsDotDotEscape(t *testing.T)
func TestResolveRejectsAbsoluteRelativePath(t *testing.T)
func TestResolveForWriteRejectsSymlinkEscape(t *testing.T)
func TestResolveForWriteAllowsSymlinkInsideRoot(t *testing.T)
```

The symlink escape test should create:

```text
root/
  link-out -> outside/
outside/
  target.txt
```

and verify `ResolveForWrite("data", "link-out/target.txt")` fails with code `outside_root`.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
go test ./internal/roots -run TestResolve -v
```

Expected: FAIL because the roots package does not exist.

- [ ] **Step 3: Implement resolver types**

Create `internal/roots/roots.go` with:

```go
package roots

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var (
	ErrUnknownRoot = errors.New("unknown_root")
	ErrOutsideRoot = errors.New("outside_root")
	ErrInvalidPath = errors.New("invalid_path")
)

type Root struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type ResolvedPath struct {
	Root Root
	Rel  string
	Abs  string
}

type Resolver struct {
	roots map[string]Root
}

func NewResolver(input []Root) Resolver
func (r Resolver) List() []Root
func (r Resolver) Resolve(rootID string, rel string) (ResolvedPath, error)
func (r Resolver) ResolveForWrite(rootID string, rel string) (ResolvedPath, error)
```

Implementation rules:

- Clean empty relative path to `"."`.
- Reject absolute relative paths.
- Reject any cleaned path that begins with `".."`.
- Resolve absolute path using root absolute path plus cleaned relative path.
- Check `abs == root.Path || strings.HasPrefix(abs, root.Path + string(os.PathSeparator))`.
- `ResolveForWrite` must evaluate symlinks for the existing target or nearest existing parent and enforce the same root boundary after evaluation.

- [ ] **Step 4: Add filesystem test helper**

Create `internal/testutil/fs.go`:

```go
package testutil

import (
	"os"
	"path/filepath"
	"testing"
)

func WriteFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
gofmt -w internal/roots internal/testutil
go test ./internal/roots ./internal/testutil
git add internal/roots internal/testutil
git commit -m "feat: add root path resolver"
```

Expected: tests pass and the commit succeeds.

---

### Task 5: Natural Sorting And Directory Browser

**Files:**
- Create: `internal/natsort/natsort.go`
- Create: `internal/browser/browser.go`
- Test: `internal/natsort/natsort_test.go`
- Test: `internal/browser/browser_test.go`

- [ ] **Step 1: Write natural sort tests**

Create `internal/natsort/natsort_test.go`:

```go
package natsort

import (
	"sort"
	"testing"
)

func TestLessUsesWindowsExplorerStyleNumberComparison(t *testing.T) {
	names := []string{"file100", "file10", "file02", "file2", "file1"}
	sort.SliceStable(names, func(i, j int) bool { return Less(names[i], names[j]) })
	want := []string{"file1", "file2", "file02", "file10", "file100"}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("sorted[%d] = %q, want %q; all=%v", i, names[i], want[i], names)
		}
	}
}

func TestLessIsCaseInsensitiveWithStableTieBreaker(t *testing.T) {
	names := []string{"beta", "Alpha", "alpha2", "alpha10"}
	sort.SliceStable(names, func(i, j int) bool { return Less(names[i], names[j]) })
	want := []string{"Alpha", "alpha2", "alpha10", "beta"}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("sorted[%d] = %q, want %q; all=%v", i, names[i], want[i], names)
		}
	}
}
```

- [ ] **Step 2: Write browser tests**

Create `internal/browser/browser_test.go` covering:

```go
func TestListDirectoryReturnsNaturalSortedEntries(t *testing.T)
func TestListDirectoryIncludesSymlinkMetadata(t *testing.T)
func TestListDirectoryRejectsFilePath(t *testing.T)
```

Use a temporary root and `roots.NewResolver`.

- [ ] **Step 3: Implement natural sorting**

Create `internal/natsort/natsort.go`:

```go
package natsort

func Less(a, b string) bool
```

Implementation rules:

- Iterate through both strings by UTF-8 rune.
- When both current segments start with ASCII digits, parse the full digit run.
- Compare numeric values without integer overflow by trimming leading zeroes, comparing length, then lexical digits.
- If numeric values match, shorter original digit width sorts first.
- Compare non-digit runs with `strings.ToLower`.
- Use original string comparison as final tie-breaker.

- [ ] **Step 4: Implement browser service**

Create `internal/browser/browser.go` with:

```go
type Entry struct {
	Name          string `json:"name"`
	RelativePath  string `json:"relativePath"`
	Type          string `json:"type"`
	Size          int64  `json:"size"`
	Mode          string `json:"mode"`
	ModifiedUnix  int64  `json:"modifiedUnix"`
	IsSymlink     bool   `json:"isSymlink"`
	SymlinkTarget string `json:"symlinkTarget,omitempty"`
}

type Service struct {
	Resolver roots.Resolver
}

func (s Service) List(ctx context.Context, rootID string, rel string) ([]Entry, error)
```

Use `os.ReadDir`, `entry.Info`, `os.Readlink`, and `natsort.Less`. Directories should sort before files when names are otherwise unrelated only if the UI asks for it; for the first release sort all entries by name with natural ordering.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
gofmt -w internal/natsort internal/browser
go test ./internal/natsort ./internal/browser
git add internal/natsort internal/browser
git commit -m "feat: add natural sorted browser"
```

Expected: tests pass and the commit succeeds.

---

### Task 6: PowerRename-Style Rename Planner

**Files:**
- Create: `internal/rename/types.go`
- Create: `internal/rename/planner.go`
- Test: `internal/rename/planner_test.go`

- [ ] **Step 1: Write rename planner tests**

Create `internal/rename/planner_test.go` with tests for:

```go
func TestPlanPlainReplaceFirstOccurrence(t *testing.T)
func TestPlanPlainReplaceAllOccurrences(t *testing.T)
func TestPlanCaseInsensitiveReplace(t *testing.T)
func TestPlanRegexReplaceWithCapture(t *testing.T)
func TestPlanApplyToExtensionOnly(t *testing.T)
func TestPlanEnumerateUsesNaturalOrder(t *testing.T)
func TestPlanDetectsDuplicateTargets(t *testing.T)
func TestPlanSkipsFilesAndDirectoriesByOptions(t *testing.T)
```

Use input items named `file100.txt`, `file02.txt`, and `file2.txt` to verify enumeration order.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
go test ./internal/rename -run TestPlan -v
```

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Define rename types**

Create `internal/rename/types.go`:

```go
package rename

type TargetPart string

const (
	TargetName      TargetPart = "name"
	TargetExtension TargetPart = "extension"
	TargetBoth      TargetPart = "both"
)

type Options struct {
	Search            string     `json:"search"`
	Replace           string     `json:"replace"`
	UseRegex          bool       `json:"useRegex"`
	CaseSensitive     bool       `json:"caseSensitive"`
	MatchAll          bool       `json:"matchAll"`
	Target            TargetPart `json:"target"`
	IncludeFiles      bool       `json:"includeFiles"`
	IncludeDirs       bool       `json:"includeDirs"`
	IncludeSubfolders bool       `json:"includeSubfolders"`
	Enumerate         bool       `json:"enumerate"`
}

type InputItem struct {
	RelativePath string
	IsDir        bool
}

type PlanItem struct {
	SourcePath string `json:"sourcePath"`
	TargetPath string `json:"targetPath"`
	OldName    string `json:"oldName"`
	NewName    string `json:"newName"`
	Changed    bool   `json:"changed"`
	Conflict   bool   `json:"conflict"`
	ErrorCode  string `json:"errorCode,omitempty"`
	ErrorText  string `json:"errorText,omitempty"`
}

type Plan struct {
	Items       []PlanItem `json:"items"`
	HasConflict bool       `json:"hasConflict"`
}
```

- [ ] **Step 4: Implement planner**

Create `internal/rename/planner.go`:

```go
func Plan(items []InputItem, opts Options, existingTarget func(path string) bool) (Plan, error)
```

Implementation requirements:

- Sort input by base name using `natsort.Less`, then by full relative path.
- Skip files when `IncludeFiles` is false.
- Skip directories when `IncludeDirs` is false.
- Split name and extension with `filepath.Ext`.
- Apply replacement to name, extension, or full base name according to `Target`.
- Plain replacement must support first match or all matches.
- Case-insensitive plain replacement must preserve replacement text exactly.
- Regex replacement must use Go RE2 syntax and `regexp.ExpandString` for captures.
- Enumeration appends ` (1)`, ` (2)`, ` (3)` to the selected name part after replacement.
- Reject path separators in generated names with `ErrorCode: "invalid_name"`.
- Detect duplicate targets in the batch with `ErrorCode: "duplicate_target"`.
- Mark existing target conflicts with `ErrorCode: "target_exists"`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
gofmt -w internal/rename
go test ./internal/rename ./internal/natsort
git add internal/rename
git commit -m "feat: add rename planner"
```

Expected: tests pass and the commit succeeds.

---

### Task 7: File Operation Planner And Executor

**Files:**
- Create: `internal/ops/types.go`
- Create: `internal/ops/planner.go`
- Create: `internal/ops/executor.go`
- Test: `internal/ops/planner_test.go`
- Test: `internal/ops/executor_test.go`

- [ ] **Step 1: Write planner tests**

Create `internal/ops/planner_test.go` with tests for:

```go
func TestPlanCopyDetectsExistingDestination(t *testing.T)
func TestPlanMoveDetectsMissingSource(t *testing.T)
func TestPlanHardLinkRejectsDirectory(t *testing.T)
func TestPlanDeleteHasNoDestination(t *testing.T)
func TestPlanMkdirDetectsExistingPath(t *testing.T)
```

- [ ] **Step 2: Write executor tests**

Create `internal/ops/executor_test.go` with tests using temporary directories:

```go
func TestExecutorCopiesFile(t *testing.T)
func TestExecutorMovesFile(t *testing.T)
func TestExecutorCreatesSymlink(t *testing.T)
func TestExecutorCreatesHardLink(t *testing.T)
func TestExecutorDeletesFile(t *testing.T)
func TestExecutorCopiesDirectoryRecursively(t *testing.T)
```

Skip hardlink tests with `t.Skip` only when `os.Link` returns a platform or filesystem error that proves the temporary filesystem does not support hard links.

- [ ] **Step 3: Define operation types**

Create `internal/ops/types.go`:

```go
type OperationType string

const (
	OpMove     OperationType = "move"
	OpCopy     OperationType = "copy"
	OpSymlink  OperationType = "symlink"
	OpHardlink OperationType = "hardlink"
	OpDelete   OperationType = "delete"
	OpMkdir    OperationType = "mkdir"
)

type Request struct {
	Type       OperationType `json:"type"`
	SourceRoot string        `json:"sourceRoot"`
	Sources    []string      `json:"sources"`
	DestRoot   string        `json:"destRoot,omitempty"`
	DestPath   string        `json:"destPath,omitempty"`
	NewName    string        `json:"newName,omitempty"`
}

type PlanItem struct {
	Operation  OperationType `json:"operation"`
	SourcePath string        `json:"sourcePath"`
	DestPath   string        `json:"destPath,omitempty"`
	Conflict   bool          `json:"conflict"`
	ErrorCode  string        `json:"errorCode,omitempty"`
	ErrorText  string        `json:"errorText,omitempty"`
}

type Plan struct {
	Items       []PlanItem `json:"items"`
	HasConflict bool       `json:"hasConflict"`
}
```

- [ ] **Step 4: Implement planner**

Create `internal/ops/planner.go`:

```go
type Planner struct {
	Resolver roots.Resolver
}

func (p Planner) Plan(ctx context.Context, req Request) (Plan, error)
```

Rules:

- Use `Resolver.ResolveForWrite` for every source and destination path used by write operations.
- For move/copy/symlink/hardlink, destination is `DestPath + base(source)`.
- For mkdir, destination is `DestPath + NewName`.
- Mark conflict when destination already exists.
- Mark hardlink directory requests with `ErrorCode: "hardlink_directory"`.
- Mark missing source with `ErrorCode: "missing_source"`.
- Do not overwrite.

- [ ] **Step 5: Implement executor**

Create `internal/ops/executor.go`:

```go
type Executor struct {
	Resolver roots.Resolver
}

func (e Executor) Execute(ctx context.Context, item PlanItem) error
```

Implement:

- `move`: `os.Rename`.
- `copy`: recursive copy with file mode preservation for regular files and directories.
- `symlink`: `os.Symlink` using the resolved absolute source path.
- `hardlink`: `os.Link` for regular files.
- `delete`: `os.RemoveAll`.
- `mkdir`: `os.Mkdir`.

Check `ctx.Err()` before each item and during recursive copy.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
gofmt -w internal/ops
go test ./internal/ops ./internal/roots
git add internal/ops
git commit -m "feat: add file operation planner"
```

Expected: tests pass and the commit succeeds.

---

### Task 8: Job Store, Runner, Cancellation, And Audit Records

**Files:**
- Create: `internal/jobs/types.go`
- Create: `internal/jobs/store.go`
- Create: `internal/jobs/runner.go`
- Create: `internal/audit/audit.go`
- Test: `internal/jobs/runner_test.go`
- Test: `internal/jobs/store_test.go`

- [ ] **Step 1: Write job store tests**

Create `internal/jobs/store_test.go` with tests for:

```go
func TestCreateAndLoadJob(t *testing.T)
func TestAppendJobItemResults(t *testing.T)
func TestRequestCancelMarksJob(t *testing.T)
func TestListJobsReturnsNewestFirst(t *testing.T)
```

- [ ] **Step 2: Write runner tests**

Create `internal/jobs/runner_test.go` with a fake executor and tests:

```go
func TestRunnerCompletesSuccessfulJob(t *testing.T)
func TestRunnerRecordsItemFailureAndContinues(t *testing.T)
func TestRunnerStopsAfterCancelRequest(t *testing.T)
func TestRunnerWritesAuditRecordForCompletedItem(t *testing.T)
```

- [ ] **Step 3: Define job types**

Create `internal/jobs/types.go`:

```go
type Status string

const (
	StatusPending             Status = "pending"
	StatusRunning             Status = "running"
	StatusCancelRequested     Status = "cancel_requested"
	StatusCompleted           Status = "completed"
	StatusCompletedWithErrors Status = "completed_with_errors"
	StatusFailed              Status = "failed"
	StatusCanceled            Status = "canceled"
)

type Job struct {
	ID               string
	Type             string
	Status           Status
	ActorID          int64
	SourceRootID     string
	DestRootID       string
	PlanJSON         string
	RootSnapshotJSON string
	ProgressTotal    int
	ProgressDone     int
	CancelRequested  bool
	ErrorMessage      string
	CreatedAtUnix     int64
	UpdatedAtUnix     int64
	FinishedAtUnix    int64
}

type ItemResult struct {
	JobID        string
	Index        int
	SourcePath   string
	DestPath     string
	Status       string
	ErrorCode    string
	ErrorMessage string
	UndoJSON     string
}
```

- [ ] **Step 4: Implement job store**

Create `internal/jobs/store.go` with methods:

```go
type Store struct { DB *sql.DB }

func (s Store) Create(ctx context.Context, job Job) error
func (s Store) Get(ctx context.Context, id string) (Job, []ItemResult, error)
func (s Store) List(ctx context.Context, limit int) ([]Job, error)
func (s Store) MarkRunning(ctx context.Context, id string) error
func (s Store) AddItemResult(ctx context.Context, result ItemResult) error
func (s Store) IncrementProgress(ctx context.Context, id string) error
func (s Store) RequestCancel(ctx context.Context, id string) error
func (s Store) IsCancelRequested(ctx context.Context, id string) (bool, error)
func (s Store) Finish(ctx context.Context, id string, status Status, message string) error
```

- [ ] **Step 5: Implement audit store**

Create `internal/audit/audit.go`:

```go
type Record struct {
	ActorID      int64
	Action       string
	SourceRootID string
	SourcePath   string
	DestRootID   string
	DestPath     string
	JobID        string
	DetailJSON   string
}

type Store struct { DB *sql.DB }

func (s Store) Insert(ctx context.Context, record Record) error
func (s Store) List(ctx context.Context, limit int) ([]Record, error)
```

- [ ] **Step 6: Implement runner**

Create `internal/jobs/runner.go`:

```go
type ExecutableItem struct {
	Index      int
	Action     string
	SourceRoot string
	SourcePath string
	DestRoot   string
	DestPath   string
	UndoJSON   string
}

type ItemExecutor interface {
	ExecuteItem(ctx context.Context, item ExecutableItem) error
}

type Runner struct {
	Store    Store
	Audit    audit.Store
	Executor ItemExecutor
}

func (r Runner) Run(ctx context.Context, jobID string, items []ExecutableItem) error
```

Runner rules:

- Mark job running before executing items.
- Check cancellation before each item.
- Record per-item success or failure.
- Continue after item failures.
- Insert an audit record for each successful item.
- Finish as completed, completed with errors, canceled, or failed.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
gofmt -w internal/jobs internal/audit
go test ./internal/jobs ./internal/audit ./internal/store
git add internal/jobs internal/audit
git commit -m "feat: add background job runner"
```

Expected: tests pass and the commit succeeds.

---

### Task 9: REST Router And Backend API Wiring

**Files:**
- Create: `internal/web/respond.go`
- Create: `internal/web/errors.go`
- Create: `internal/web/router.go`
- Create: `internal/jobs/handlers.go`
- Modify: `cmd/filebutler/main.go`
- Test: `internal/web/router_test.go`

- [ ] **Step 1: Write router tests**

Create `internal/web/router_test.go` with `httptest` cases:

```go
func TestHealthEndpoint(t *testing.T)
func TestInitStatusEndpoint(t *testing.T)
func TestProtectedRoutesRequireLogin(t *testing.T)
func TestCreateAdminThenLoginThenMe(t *testing.T)
func TestRootsEndpointReturnsConfiguredRoots(t *testing.T)
func TestBrowseEndpointReturnsEntries(t *testing.T)
```

- [ ] **Step 2: Implement JSON response helpers**

Create `internal/web/respond.go`:

```go
func Data(w http.ResponseWriter, status int, value any)
func Error(w http.ResponseWriter, status int, code string, message string)
func DecodeJSON(r *http.Request, dst any) error
```

Create `internal/web/errors.go` with a typed API error:

```go
type APIError struct {
	Status  int
	Code    string
	Message string
}
```

- [ ] **Step 3: Implement router dependencies and routes**

Create `internal/web/router.go`:

```go
type Deps struct {
	Config      config.Config
	Auth        auth.Service
	Roots       roots.Resolver
	Browser     browser.Service
	OpsPlanner  ops.Planner
	RenameStore jobs.Store
	JobStore    jobs.Store
	AuditStore  audit.Store
}

func NewRouter(deps Deps) http.Handler
```

Routes:

- `GET /api/health`
- `GET /api/init/status`
- `POST /api/init/admin`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/roots`
- `GET /api/browse`
- `POST /api/ops/dry-run`
- `POST /api/rename/preview`
- `GET /api/jobs`
- `GET /api/jobs/{id}`
- `POST /api/jobs/{id}/cancel`
- `GET /api/audit`

Protected routes must use auth middleware except health, init status, create admin, and login.

- [ ] **Step 4: Implement job handlers**

Create `internal/jobs/handlers.go` with:

```go
func ListHandler(store Store) http.HandlerFunc
func GetHandler(store Store) http.HandlerFunc
func CancelHandler(store Store) http.HandlerFunc
```

- [ ] **Step 5: Update main to use real dependencies**

Modify `cmd/filebutler/main.go` to:

- Load config.
- Open SQLite.
- Build root resolver from config roots.
- Construct services.
- Start `web.NewRouter`.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
gofmt -w cmd internal/web internal/jobs
go test ./...
git add cmd internal/web internal/jobs
git commit -m "feat: wire backend api router"
```

Expected: all backend tests pass and the commit succeeds.

---

### Task 10: Backend Job Creation Endpoints For Ops And Rename

**Files:**
- Modify: `internal/web/router.go`
- Create: `internal/ops/handlers.go`
- Create: `internal/rename/handlers.go`
- Test: `internal/ops/handlers_test.go`
- Test: `internal/rename/handlers_test.go`

- [ ] **Step 1: Write handler tests**

Create tests for:

```go
func TestOpsDryRunReturnsPlan(t *testing.T)
func TestOpsCreateJobPersistsPendingJob(t *testing.T)
func TestRenamePreviewReturnsNaturalSortedPlan(t *testing.T)
func TestRenameCreateJobRejectsConflictingPlan(t *testing.T)
```

- [ ] **Step 2: Implement ops handlers**

Create `internal/ops/handlers.go` with:

```go
func DryRunHandler(planner Planner) http.HandlerFunc
func CreateJobHandler(planner Planner, store jobs.Store, runner jobs.Runner) http.HandlerFunc
```

The create job handler must:

- Recompute the dry-run plan server-side.
- Reject plans with conflicts.
- Persist a pending job with plan JSON.
- Start the runner in a goroutine.
- Return the job id.

- [ ] **Step 3: Implement rename handlers**

Create `internal/rename/handlers.go` with:

```go
func PreviewHandler(browser browser.Service) http.HandlerFunc
func CreateJobHandler(browser browser.Service, store jobs.Store, runner jobs.Runner) http.HandlerFunc
```

The preview handler must:

- Accept root id, selected relative paths, and rename options.
- Load metadata for selected paths.
- Generate the rename plan.
- Return conflicts and items.

The create job handler must reject conflicts and persist a runnable job.

- [ ] **Step 4: Wire routes**

Modify `internal/web/router.go` to add:

- `POST /api/ops/jobs`
- `POST /api/rename/jobs`

- [ ] **Step 5: Run tests and commit**

Run:

```bash
gofmt -w internal/ops internal/rename internal/web
go test ./...
git add internal/ops internal/rename internal/web
git commit -m "feat: add operation job endpoints"
```

Expected: tests pass and the commit succeeds.

---

### Task 11: Frontend Scaffold, API Client, And Test Harness

**Files:**
- Create: `web/package.json`
- Create: `web/index.html`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/api/client.ts`
- Create: `web/src/api/types.ts`
- Create: `web/src/test/setup.ts`
- Create: `web/src/styles.css`

- [ ] **Step 1: Create Vite React app files**

Run:

```bash
npm create vite@latest web -- --template react-ts
cd web
npm install
npm install -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom playwright
cd ..
```

Expected: `web/package.json` exists and `npm --prefix web run build` can run after minimal app edits.

- [ ] **Step 2: Define API types**

Create `web/src/api/types.ts`:

```ts
export type Root = { id: string; name: string };
export type Entry = {
  name: string;
  relativePath: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  mode: string;
  modifiedUnix: number;
  isSymlink: boolean;
  symlinkTarget?: string;
};
export type RenameOptions = {
  search: string;
  replace: string;
  useRegex: boolean;
  caseSensitive: boolean;
  matchAll: boolean;
  target: "name" | "extension" | "both";
  includeFiles: boolean;
  includeDirs: boolean;
  includeSubfolders: boolean;
  enumerate: boolean;
};
export type PlanItem = {
  sourcePath: string;
  destPath?: string;
  targetPath?: string;
  oldName?: string;
  newName?: string;
  conflict: boolean;
  errorCode?: string;
  errorText?: string;
};
export type Job = {
  id: string;
  type: string;
  status: string;
  progressTotal: number;
  progressDone: number;
  errorMessage: string;
};
```

- [ ] **Step 3: Implement API client**

Create `web/src/api/client.ts`:

```ts
export class APIError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body.error ?? { code: "http_error", message: res.statusText };
    throw new APIError(error.code, error.message, res.status);
  }
  return body.data as T;
}

export const api = {
  initStatus: () => request<{ needsInitialization: boolean }>("/api/init/status"),
  createAdmin: (username: string, password: string) =>
    request<{ username: string }>("/api/init/admin", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<{ username: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => request<{ username: string }>("/api/auth/me"),
  roots: () => request<import("./types").Root[]>("/api/roots"),
  browse: (rootId: string, path: string) =>
    request<import("./types").Entry[]>(`/api/browse?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`),
  jobs: () => request<import("./types").Job[]>("/api/jobs"),
};
```

- [ ] **Step 4: Configure Vitest**

Update `web/vite.config.ts` so `test.environment` is `jsdom` and setup file is `web/src/test/setup.ts`. Create setup:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Run frontend tests and commit**

Run:

```bash
npm --prefix web run build
npm --prefix web run test -- --run
git add web
git commit -m "feat: scaffold frontend app"
```

Expected: build and tests pass, commit succeeds.

---

### Task 12: Initialization And Login UI

**Files:**
- Modify: `web/src/App.tsx`
- Create: `web/src/components/InitScreen.tsx`
- Create: `web/src/components/LoginScreen.tsx`
- Create: `web/src/components/ErrorBanner.tsx`
- Test: `web/src/components/InitScreen.test.tsx`
- Test: `web/src/components/LoginScreen.test.tsx`

- [ ] **Step 1: Write component tests**

Test cases:

```ts
it("submits custom admin username and password from InitScreen")
it("shows validation message for short password in InitScreen")
it("submits login credentials from LoginScreen")
it("shows API errors in LoginScreen")
```

Mock `api.createAdmin` and `api.login` with Vitest.

- [ ] **Step 2: Implement `ErrorBanner`**

Create a compact component:

```tsx
export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="error-banner" role="alert">{message}</div>;
}
```

- [ ] **Step 3: Implement `InitScreen`**

Fields:

- Username.
- Password.
- Confirm password.

Client validation:

- Username cannot be blank.
- Password length must be at least 10.
- Confirm password must match.

- [ ] **Step 4: Implement `LoginScreen`**

Fields:

- Username.
- Password.

On success, call `onLoggedIn`.

- [ ] **Step 5: Update `App` bootstrap**

`App` flow:

1. Call `/api/init/status`.
2. If initialization is needed, show `InitScreen`.
3. Otherwise call `/api/auth/me`.
4. If authenticated, show main app shell.
5. If unauthenticated, show `LoginScreen`.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm --prefix web run test -- --run
npm --prefix web run build
git add web/src
git commit -m "feat: add init and login screens"
```

Expected: tests and build pass.

---

### Task 13: Dual-Pane File Browser UI

**Files:**
- Create: `web/src/components/DualPane.tsx`
- Create: `web/src/components/FilePane.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`
- Test: `web/src/components/FilePane.test.tsx`
- Test: `web/src/components/DualPane.test.tsx`

- [ ] **Step 1: Write browser component tests**

Test cases:

```ts
it("loads roots and renders two panes")
it("loads entries when a root is selected")
it("supports selecting and clearing file selections")
it("navigates into a directory")
it("renders symlink target metadata")
```

- [ ] **Step 2: Implement `FilePane`**

Props:

```ts
type FilePaneProps = {
  title: string;
  roots: Root[];
  selectedRootId: string;
  currentPath: string;
  entries: Entry[];
  selectedPaths: Set<string>;
  onRootChange(rootId: string): void;
  onPathChange(path: string): void;
  onToggleSelection(path: string): void;
  onRefresh(): void;
};
```

UI requirements:

- Root selector.
- Current path breadcrumb as text buttons.
- Refresh icon button using text fallback if no icon library exists.
- File table with name, type, size, modified time.
- Checkboxes for selection.
- Directory rows navigate on double click.

- [ ] **Step 3: Implement `DualPane` state**

State:

- Left root and path.
- Right root and path.
- Left entries and right entries.
- Left selection and right selection.
- Active pane.

Load roots on mount and browse each pane independently.

- [ ] **Step 4: Apply utilitarian layout CSS**

Use a dense application layout:

- Full-height shell.
- Toolbar at top.
- Two equal panes separated by a resizable-looking divider.
- Stable row height.
- No nested cards.
- Buttons with predictable compact dimensions.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm --prefix web run test -- --run
npm --prefix web run build
git add web/src
git commit -m "feat: add dual pane browser"
```

Expected: tests and build pass.

---

### Task 14: Operation Preview And Job Progress UI

**Files:**
- Create: `web/src/components/OperationPreview.tsx`
- Create: `web/src/components/JobsPanel.tsx`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/components/DualPane.tsx`
- Test: `web/src/components/OperationPreview.test.tsx`
- Test: `web/src/components/JobsPanel.test.tsx`

- [ ] **Step 1: Extend API client**

Add client methods:

```ts
opsDryRun(request: OpsRequest): Promise<{ items: PlanItem[]; hasConflict: boolean }>
opsCreateJob(request: OpsRequest): Promise<{ id: string }>
job(id: string): Promise<Job & { items: PlanItem[] }>
cancelJob(id: string): Promise<{ id: string }>
```

- [ ] **Step 2: Write UI tests**

Test cases:

```ts
it("shows conflicts in operation preview and disables confirmation")
it("creates a job from a conflict-free operation plan")
it("polls job progress and renders completed status")
it("sends cancel request for a running job")
```

- [ ] **Step 3: Implement operation toolbar in `DualPane`**

Commands:

- Move selected to opposite pane.
- Copy selected to opposite pane.
- Soft link selected to opposite pane.
- Hard link selected to opposite pane.
- Delete selected.
- Create directory in active pane.

All destructive or batch commands open `OperationPreview` before job creation.

- [ ] **Step 4: Implement `OperationPreview`**

Display:

- Operation type.
- Source paths.
- Destination paths.
- Conflict badges.
- Error text.
- Confirm button disabled when `hasConflict` is true.

- [ ] **Step 5: Implement `JobsPanel`**

Polling behavior:

- Poll `/api/jobs` every 2 seconds while panel is open.
- Poll selected job detail every 1 second if status is running or cancel requested.
- Stop detail polling for completed, failed, and canceled states.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm --prefix web run test -- --run
npm --prefix web run build
git add web/src
git commit -m "feat: add operation preview and jobs ui"
```

Expected: tests and build pass.

---

### Task 15: Rename Workflow UI

**Files:**
- Create: `web/src/components/RenameDialog.tsx`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/components/DualPane.tsx`
- Test: `web/src/components/RenameDialog.test.tsx`

- [ ] **Step 1: Extend API client for rename**

Add methods:

```ts
renamePreview(request: RenameRequest): Promise<{ items: PlanItem[]; hasConflict: boolean }>
renameCreateJob(request: RenameRequest): Promise<{ id: string }>
```

Define `RenameRequest` with:

```ts
type RenameRequest = {
  rootId: string;
  paths: string[];
  options: RenameOptions;
};
```

- [ ] **Step 2: Write rename dialog tests**

Test cases:

```ts
it("requests preview when rename options change")
it("shows original and renamed values")
it("disables run button when preview has conflicts")
it("creates a rename job from selected files")
it("keeps enumerate option visible with a checkbox")
```

- [ ] **Step 3: Implement `RenameDialog`**

Controls:

- Search input.
- Replace input.
- Regex checkbox.
- Case-sensitive checkbox.
- Match-all checkbox.
- Target segmented control: name, extension, both.
- Include files checkbox.
- Include folders checkbox.
- Include subfolders checkbox.
- Enumerate checkbox.

Preview table:

- Source path.
- Old name.
- New name.
- Conflict or error.

- [ ] **Step 4: Wire rename command into `DualPane`**

Add a toolbar command that opens `RenameDialog` for selected items in the active pane. After job creation, close the dialog and open or refresh `JobsPanel`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm --prefix web run test -- --run
npm --prefix web run build
git add web/src
git commit -m "feat: add batch rename ui"
```

Expected: tests and build pass.

---

### Task 16: Static Serving, Docker, Local Deployment, And End-To-End Checks

**Files:**
- Create: `internal/web/static.go`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `README.md`
- Modify: `cmd/filebutler/main.go`
- Modify: `web/package.json`
- Test: `web/e2e/filebutler.spec.ts`

- [ ] **Step 1: Implement static frontend serving**

Create `internal/web/static.go`:

```go
func StaticHandler(distDir string) http.Handler
```

Rules:

- Serve files from `web/dist` or configured static directory.
- Return `index.html` for non-API paths so React routing works.
- Never intercept paths beginning with `/api/`.

Modify `cmd/filebutler/main.go` to mount static handler after API routes.

- [ ] **Step 2: Add Dockerfile**

Create a multi-stage `Dockerfile`:

```dockerfile
FROM node:25-alpine AS frontend
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM golang:1.26-alpine AS backend
WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /src/web/dist ./web/dist
RUN go build -o /out/filebutler ./cmd/filebutler

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=backend /out/filebutler /usr/local/bin/filebutler
COPY configs/filebutler.example.yaml /app/filebutler.yaml
EXPOSE 8080
ENTRYPOINT ["filebutler"]
CMD ["-config", "/app/filebutler.yaml"]
```

Create `.dockerignore`:

```text
.git
web/node_modules
web/dist
data
```

- [ ] **Step 3: Add README deployment instructions**

Create `README.md` with:

- Project purpose.
- Linux local build command: `go build -o bin/filebutler ./cmd/filebutler`.
- Frontend build command: `npm --prefix web ci && npm --prefix web run build`.
- Docker build command: `docker build -t filebutler:local .`.
- Example Docker run command with mounted `/data/downloads`, `/data/media`, and `/app/data`.
- First-run admin initialization flow.
- Security warning to use HTTPS reverse proxy and not expose the service directly to the public internet.

- [ ] **Step 4: Add Playwright end-to-end smoke test**

Create `web/e2e/filebutler.spec.ts` covering:

```ts
test("initializes admin, logs in, and sees two file panes")
```

Use a running local server. The test should:

- Visit `/`.
- Create admin if init screen appears.
- Log in.
- Assert left and right panes are visible.

- [ ] **Step 5: Run full verification**

Run:

```bash
gofmt -w cmd internal
go test ./...
npm --prefix web run test -- --run
npm --prefix web run build
go build -o /tmp/filebutler ./cmd/filebutler
docker build -t filebutler:local .
```

Expected:

- Backend tests pass.
- Frontend tests pass.
- Frontend build succeeds.
- Go binary builds.
- Docker image builds.

- [ ] **Step 6: Commit final MVP scaffolding**

Run:

```bash
git add Dockerfile .dockerignore README.md cmd internal web configs go.mod go.sum
git commit -m "feat: add deployable filebutler mvp"
```

Expected: commit succeeds.

---

## Final Verification Checklist

Run this after Task 16:

```bash
git status --short --branch
go test ./...
npm --prefix web run test -- --run
npm --prefix web run build
go build -o /tmp/filebutler ./cmd/filebutler
docker build -t filebutler:local .
```

Expected:

- `git status --short --branch` shows the current branch and no unstaged files after the final commit.
- Go tests pass.
- Frontend tests pass.
- Frontend build passes.
- Linux binary builds.
- Docker image builds.

## Spec Coverage Map

- Docker deployment: Task 16.
- Linux local binary deployment: Tasks 1 and 16.
- First-run administrator initialization: Tasks 3, 9, and 12.
- Administrator login: Tasks 3, 9, and 12.
- Multiple storage roots: Tasks 1, 4, 9, and 13.
- Dual-pane Web UI: Task 13.
- Root-bounded directory browsing: Tasks 4, 5, 9, and 13.
- Move, copy, soft link, hard link, directory creation, and delete: Tasks 7, 10, and 14.
- Dry-run preview: Tasks 7, 10, and 14.
- Background jobs with progress, cancellation, failures, and audit logs: Tasks 8, 9, 10, and 14.
- PowerRename-style batch rename: Tasks 6, 10, and 15.
- Windows Explorer-style natural sorting: Tasks 5 and 6.
- SQLite persistence: Tasks 2, 3, and 8.
- Session security and deployment warning: Tasks 3 and 16.

## Implementation Contracts

Use these contracts consistently across tasks. When implementation details appear to conflict, this section wins unless a later task explicitly updates it with tests.

### JSON Envelope

Successful responses:

```json
{
  "data": {}
}
```

Error responses:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "human readable message"
  }
}
```

### Auth Payloads

`GET /api/init/status` returns:

```json
{
  "data": {
    "needsInitialization": true
  }
}
```

`POST /api/init/admin` accepts:

```json
{
  "username": "admin",
  "password": "long-password"
}
```

and returns:

```json
{
  "data": {
    "id": 1,
    "username": "admin"
  }
}
```

`POST /api/auth/login` accepts the same username and password payload and returns the same user shape while setting the session cookie.

`GET /api/auth/me` returns the current user:

```json
{
  "data": {
    "id": 1,
    "username": "admin"
  }
}
```

### Roots And Browse Payloads

`GET /api/roots` returns:

```json
{
  "data": [
    { "id": "downloads", "name": "Downloads" }
  ]
}
```

Do not return absolute root paths to the frontend.

`GET /api/browse?rootId=downloads&path=.` returns:

```json
{
  "data": [
    {
      "name": "file2.txt",
      "relativePath": "file2.txt",
      "type": "file",
      "size": 12,
      "mode": "-rw-r--r--",
      "modifiedUnix": 1781961600,
      "isSymlink": false
    }
  ]
}
```

### Operation Payloads

Operation dry-run and create-job endpoints accept:

```json
{
  "type": "copy",
  "sourceRoot": "downloads",
  "sources": ["file2.txt", "folder"],
  "destRoot": "media",
  "destPath": ".",
  "newName": ""
}
```

`type` values are `move`, `copy`, `symlink`, `hardlink`, `delete`, and `mkdir`.

Dry-run returns:

```json
{
  "data": {
    "items": [
      {
        "operation": "copy",
        "sourcePath": "file2.txt",
        "destPath": "file2.txt",
        "conflict": false
      }
    ],
    "hasConflict": false
  }
}
```

Create-job returns:

```json
{
  "data": {
    "id": "job_1781961600000000000_abcd"
  }
}
```

### Rename Payloads

Rename preview and create-job endpoints accept:

```json
{
  "rootId": "downloads",
  "paths": ["file100.txt", "file02.txt"],
  "options": {
    "search": "file",
    "replace": "photo",
    "useRegex": false,
    "caseSensitive": false,
    "matchAll": true,
    "target": "name",
    "includeFiles": true,
    "includeDirs": false,
    "includeSubfolders": false,
    "enumerate": true
  }
}
```

Preview returns:

```json
{
  "data": {
    "items": [
      {
        "sourcePath": "file02.txt",
        "targetPath": "photo02 (1).txt",
        "oldName": "file02.txt",
        "newName": "photo02 (1).txt",
        "changed": true,
        "conflict": false
      }
    ],
    "hasConflict": false
  }
}
```

### Job Payloads

`GET /api/jobs` returns newest jobs first:

```json
{
  "data": [
    {
      "id": "job_1781961600000000000_abcd",
      "type": "copy",
      "status": "running",
      "progressTotal": 10,
      "progressDone": 3,
      "errorMessage": ""
    }
  ]
}
```

`GET /api/jobs/{id}` returns job details:

```json
{
  "data": {
    "id": "job_1781961600000000000_abcd",
    "type": "copy",
    "status": "completed",
    "progressTotal": 1,
    "progressDone": 1,
    "errorMessage": "",
    "items": [
      {
        "sourcePath": "file2.txt",
        "destPath": "file2.txt",
        "status": "completed",
        "errorCode": "",
        "errorMessage": ""
      }
    ]
  }
}
```

Job status values are:

```text
pending
running
cancel_requested
completed
completed_with_errors
failed
canceled
```

### Audit Payloads

`GET /api/audit` returns newest audit records first:

```json
{
  "data": [
    {
      "actorId": 1,
      "action": "copy",
      "sourceRootId": "downloads",
      "sourcePath": "file2.txt",
      "destRootId": "media",
      "destPath": "file2.txt",
      "jobId": "job_1781961600000000000_abcd",
      "detail": {},
      "createdAtUnix": 1781961600
    }
  ]
}
```

### Error Codes

Use these string codes in backend plans and API errors:

```text
invalid_request
unauthorized
forbidden
not_found
unknown_root
outside_root
invalid_path
missing_source
target_exists
duplicate_target
invalid_name
hardlink_directory
operation_failed
cancel_requested
```

### Frontend Test Mocking

Frontend unit tests should mock API methods, not `fetch` directly, except API client tests. Use this pattern:

```ts
vi.mock("../api/client", () => ({
  api: {
    initStatus: vi.fn(),
    createAdmin: vi.fn(),
    login: vi.fn(),
    me: vi.fn(),
    roots: vi.fn(),
    browse: vi.fn(),
    jobs: vi.fn(),
  },
}));
```

When testing timers for job polling, use:

```ts
vi.useFakeTimers();
await act(async () => {
  vi.advanceTimersByTime(2000);
});
vi.useRealTimers();
```

### Commit Discipline

Every task ends with a commit. If a task needs network access for `go get`, `npm install`, or Docker base image pulls, request approval for that command and keep the command exactly as written in the task.
