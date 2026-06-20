# FileButler MVP 实施计划

> **给 agentic workers：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步实现本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 构建 FileButler 的第一版：一个可在 Linux/Docker 中自托管的双栏文件管理器，包含管理员登录、安全的根目录边界文件操作、PowerRename 风格批量重命名、作业跟踪、SQLite 持久化和 React UI。

**架构：** 一个 Go HTTP 服务器托管 REST API 和构建后的 React 资源。后端模块按 auth、config、roots、browser、rename、ops、jobs、audit 和 web routing 划分。SQLite 存储账号、会话、作业、条目结果、审计记录和撤销元数据；配置负责存储根目录。

**技术栈：** Go 1.26+、chi router、`modernc.org/sqlite`、`golang.org/x/crypto/argon2`、YAML 配置、React/Vite/TypeScript、Vitest、Playwright、Docker。

---

## 范围确认

本计划实现 `docs/superpowers/specs/2026-06-20-filebutler-design.md` 中描述的完整第一版。功能横跨后端、前端和部署，但各子系统都围绕一个可运行的 MVP 紧密耦合。保持每个任务都能独立测试，并在每个任务后提交。

已确定的实现选择：

- 路由器：`github.com/go-chi/chi/v5`。
- SQLite 驱动：使用 `modernc.org/sqlite` 以避免 CGO。
- 迁移：在 Go 中嵌入 SQL 迁移，并在启动时应用。
- 密码哈希：Argon2id，编码格式为 `$argon2id$v=19$m=65536,t=3,p=2$...`。
- 作业进度：第一版先使用轮询端点。
- 前端 UI：使用自定义 React 组件和 CSS，第一版不引入组件库。
- 冲突策略：第一版采用保守的不覆盖行为。
- 正则引擎：通过 `regexp` 使用 Go RE2 语法，并支持 `$1` 风格的捕获组展开。

## 目标文件结构

实现过程中创建以下结构：

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

后端测试以 `*_test.go` 放在后端包旁边。前端测试以 `*.test.tsx` 放在 React 组件旁边。

---

### 任务 1：后端脚手架、配置加载和健康检查端点

**文件：**
- 创建： `go.mod`
- 创建： `cmd/filebutler/main.go`
- 创建： `configs/filebutler.example.yaml`
- 创建： `internal/config/config.go`
- 测试： `internal/config/config_test.go`

- [ ] **步骤 1：初始化 Go 模块并添加基础依赖**

运行：

```bash
go mod init github.com/little6neko/filebutler
go get github.com/go-chi/chi/v5 gopkg.in/yaml.v3
```

预期：`go.mod` 和 `go.sum` 存在，并且 `go test ./...` 能发现空模块且没有包错误。

- [ ] **步骤 2：编写配置加载测试**

创建 `internal/config/config_test.go`，包含这些测试用例：

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

- [ ] **步骤 3：运行配置测试并确认失败**

运行：

```bash
go test ./internal/config -run TestLoadConfig -v
```

预期：失败，因为 `Load` 和配置类型还不存在。

- [ ] **步骤 4：实现配置加载**

创建 `internal/config/config.go`：

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

- [ ] **步骤 5：添加示例配置和最小服务器**

创建 `configs/filebutler.example.yaml`：

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

创建 `cmd/filebutler/main.go`：

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

- [ ] **步骤 6：运行测试并提交**

运行：

```bash
gofmt -w cmd internal
go test ./...
git add go.mod go.sum cmd internal configs
git commit -m "feat: scaffold backend config"
```

预期：测试通过，并且提交成功。

---

### 任务 2：SQLite 存储和嵌入式迁移

**文件：**
- 创建： `internal/store/store.go`
- 创建： `internal/store/migrations.go`
- 创建： `internal/testutil/db.go`
- 测试： `internal/store/store_test.go`

- [ ] **步骤 1：添加 SQLite 依赖**

运行：

```bash
go get modernc.org/sqlite
```

预期：`go.mod` 包含 `modernc.org/sqlite`。

- [ ] **步骤 2：编写迁移测试**

创建 `internal/store/store_test.go`:

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

- [ ] **步骤 3：运行测试并确认失败**

运行：

```bash
go test ./internal/store -run Test -v
```

预期：失败，因为 `Open` 和 `ApplyMigrations` 还不存在。

- [ ] **步骤 4：实现存储打开和迁移**

创建 `internal/store/store.go`:

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

创建 `internal/store/migrations.go`，包含以下表的迁移：

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

- [ ] **步骤 5：添加数据库测试辅助函数**

创建 `internal/testutil/db.go`:

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

- [ ] **步骤 6：运行测试并提交**

运行：

```bash
gofmt -w internal
go test ./...
git add go.mod go.sum internal/store internal/testutil
git commit -m "feat: add sqlite store migrations"
```

预期：测试通过，并且提交成功。

---

### 任务 3：认证、首次运行管理员和会话

**文件：**
- 创建： `internal/auth/password.go`
- 创建： `internal/auth/auth.go`
- 创建： `internal/auth/session.go`
- 创建： `internal/auth/handlers.go`
- 测试： `internal/auth/password_test.go`
- 测试： `internal/auth/auth_test.go`

- [ ] **步骤 1：添加 crypto 依赖**

运行：

```bash
go get golang.org/x/crypto/argon2
```

- [ ] **步骤 2：编写密码测试**

创建 `internal/auth/password_test.go`:

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

- [ ] **步骤 3：编写账号和会话测试**

创建 `internal/auth/auth_test.go`，包含以下测试：

```go
func TestInitStatusAndCreateAdmin(t *testing.T)
func TestCreateAdminOnlyOnce(t *testing.T)
func TestLoginCreatesSession(t *testing.T)
func TestSessionLookupRejectsExpiredSession(t *testing.T)
```

使用 `testutil.OpenTestDB(t)`，创建 `Service`，并调用 `NeedsInitialization`、`CreateAdmin`、`Login` 和 `LookupSession`。

- [ ] **步骤 4：运行测试并确认失败**

运行：

```bash
go test ./internal/auth -run Test -v
```

预期：失败，因为认证服务和密码函数还不存在。

- [ ] **步骤 5：实现密码哈希**

创建 `internal/auth/password.go`：

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

- [ ] **步骤 6：实现认证服务和会话方法**

创建 `internal/auth/auth.go` 和 `internal/auth/session.go`：

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

实现要求：

- 裁剪用户名并拒绝空用户名。
- 拒绝短于 10 个字符的密码。
- 如果已经存在任何用户，`CreateAdmin` 必须失败。
- 会话 ID 必须使用 32 个随机字节，并用 `base64.RawURLEncoding` 编码。
- `LookupSession` 必须拒绝过期会话并删除它们。

- [ ] **步骤 7：实现认证 HTTP 处理器**

创建 `internal/auth/handlers.go`，包含以下处理器：

```go
func InitStatusHandler(service Service) http.HandlerFunc
func CreateAdminHandler(service Service) http.HandlerFunc
func LoginHandler(service Service, cookieName string, secure bool) http.HandlerFunc
func LogoutHandler(service Service, cookieName string) http.HandlerFunc
func MeHandler(service Service, cookieName string) http.HandlerFunc
func RequireAuth(service Service, cookieName string) func(http.Handler) http.Handler
```

所有 JSON 响应使用以下形状：

```json
{"data": {...}}
```

所有错误使用以下形状：

```json
{"error": {"code": "invalid_request", "message": "human readable message"}}
```

- [ ] **步骤 8：运行测试并提交**

运行：

```bash
gofmt -w internal/auth
go test ./internal/auth ./internal/store
git add go.mod go.sum internal/auth
git commit -m "feat: add admin authentication"
```

预期：测试通过，并且提交成功。

---

### 任务 4：存储根目录和边界安全的路径解析

**文件：**
- 创建： `internal/roots/roots.go`
- 创建： `internal/testutil/fs.go`
- 测试： `internal/roots/roots_test.go`

- [ ] **步骤 1：编写根目录解析测试**

创建 `internal/roots/roots_test.go`，包含以下测试：

```go
func TestResolveAllowsRelativePathInsideRoot(t *testing.T)
func TestResolveRejectsDotDotEscape(t *testing.T)
func TestResolveRejectsAbsoluteRelativePath(t *testing.T)
func TestResolveForWriteRejectsSymlinkEscape(t *testing.T)
func TestResolveForWriteAllowsSymlinkInsideRoot(t *testing.T)
```

软链接逃逸测试应创建：

```text
root/
  link-out -> outside/
outside/
  target.txt
```

并验证 `ResolveForWrite("data", "link-out/target.txt")` 会以错误码 `outside_root` 失败。

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
go test ./internal/roots -run TestResolve -v
```

预期：失败，因为 roots 包还不存在。

- [ ] **步骤 3：实现 resolver 类型**

创建 `internal/roots/roots.go`：

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

实现规则：

- 将空相对路径清理为 `"."`。
- 拒绝绝对形式的相对路径。
- 拒绝任何清理后以 `".."` 开头的路径。
- 用根目录绝对路径加清理后的相对路径解析绝对路径。
- 检查 `abs == root.Path || strings.HasPrefix(abs, root.Path + string(os.PathSeparator))`。
- `ResolveForWrite` 必须对已存在目标或最近的已存在父目录解析软链接，并在解析后执行相同的根目录边界检查。

- [ ] **步骤 4：添加文件系统测试辅助函数**

创建 `internal/testutil/fs.go`:

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

- [ ] **步骤 5：运行测试并提交**

运行：

```bash
gofmt -w internal/roots internal/testutil
go test ./internal/roots ./internal/testutil
git add internal/roots internal/testutil
git commit -m "feat: add root path resolver"
```

预期：测试通过，并且提交成功。

---

### 任务 5：自然排序和目录浏览器

**文件：**
- 创建： `internal/natsort/natsort.go`
- 创建： `internal/browser/browser.go`
- 测试： `internal/natsort/natsort_test.go`
- 测试： `internal/browser/browser_test.go`

- [ ] **步骤 1：编写自然排序测试**

创建 `internal/natsort/natsort_test.go`:

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

- [ ] **步骤 2：编写浏览器测试**

创建 `internal/browser/browser_test.go`，覆盖：

```go
func TestListDirectoryReturnsNaturalSortedEntries(t *testing.T)
func TestListDirectoryIncludesSymlinkMetadata(t *testing.T)
func TestListDirectoryRejectsFilePath(t *testing.T)
```

使用临时根目录和 `roots.NewResolver`。

- [ ] **步骤 3：实现自然排序**

创建 `internal/natsort/natsort.go`:

```go
package natsort

func Less(a, b string) bool
```

实现规则：

- 按 UTF-8 rune 同时遍历两个字符串。
- 当两个当前位置都以 ASCII 数字开头时，解析完整数字段。
- 比较数值时避免整数溢出：先裁剪前导零，再比较长度，最后按字典序比较数字。
- 如果数值相同，原始数字宽度更短的排在前面。
- 用 `strings.ToLower` 比较非数字片段。
- 最后使用原始字符串比较作为平局决胜。

- [ ] **步骤 4：实现浏览器服务**

创建 `internal/browser/browser.go`：

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

使用 `os.ReadDir`、`entry.Info`、`os.Readlink` 和 `natsort.Less`。只有 UI 明确要求时，目录才应在名称无关时排在文件前；第一版所有条目按名称自然排序。

- [ ] **步骤 5：运行测试并提交**

运行：

```bash
gofmt -w internal/natsort internal/browser
go test ./internal/natsort ./internal/browser
git add internal/natsort internal/browser
git commit -m "feat: add natural sorted browser"
```

预期：测试通过，并且提交成功。

---

### 任务 6：PowerRename 风格的重命名规划器

**文件：**
- 创建： `internal/rename/types.go`
- 创建： `internal/rename/planner.go`
- 测试： `internal/rename/planner_test.go`

- [ ] **步骤 1：编写重命名规划器测试**

创建 `internal/rename/planner_test.go`，包含以下测试：

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

使用名为 `file100.txt`、`file02.txt` 和 `file2.txt` 的输入项验证枚举顺序。

- [ ] **步骤 2：运行测试并确认失败**

运行：

```bash
go test ./internal/rename -run TestPlan -v
```

预期：失败，因为该包还不存在。

- [ ] **步骤 3：定义重命名类型**

创建 `internal/rename/types.go`:

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

- [ ] **步骤 4：实现规划器**

创建 `internal/rename/planner.go`:

```go
func Plan(items []InputItem, opts Options, existingTarget func(path string) bool) (Plan, error)
```

实现要求：

- 使用 `natsort.Less` 按基础名称排序，再按完整相对路径排序。
- 当 `IncludeFiles` 为 false 时跳过文件。
- 当 `IncludeDirs` 为 false 时跳过目录。
- 使用 `filepath.Ext` 拆分名称和扩展名。
- 根据 `Target` 将替换应用到名称、扩展名或完整基础名称。
- 普通替换必须支持只替换第一个匹配或替换全部匹配。
- 大小写不敏感的普通替换必须完整保留替换文本。
- 正则替换必须使用 Go RE2 语法，并用 `regexp.ExpandString` 处理捕获组。
- 枚举会在替换后的选定名称部分追加 ` (1)`、` (2)`、` (3)`。
- 如果生成名称包含路径分隔符，用 `ErrorCode: "invalid_name"` 拒绝。
- 用 `ErrorCode: "duplicate_target"` 检测批次内的重复目标。
- 用 `ErrorCode: "target_exists"` 标记已存在目标冲突。

- [ ] **步骤 5：运行测试并提交**

运行：

```bash
gofmt -w internal/rename
go test ./internal/rename ./internal/natsort
git add internal/rename
git commit -m "feat: add rename planner"
```

预期：测试通过，并且提交成功。

---

### 任务 7：文件操作规划器和执行器

**文件：**
- 创建： `internal/ops/types.go`
- 创建： `internal/ops/planner.go`
- 创建： `internal/ops/executor.go`
- 测试： `internal/ops/planner_test.go`
- 测试： `internal/ops/executor_test.go`

- [ ] **步骤 1：编写规划器测试**

创建 `internal/ops/planner_test.go`，包含以下测试：

```go
func TestPlanCopyDetectsExistingDestination(t *testing.T)
func TestPlanMoveDetectsMissingSource(t *testing.T)
func TestPlanHardLinkRejectsDirectory(t *testing.T)
func TestPlanDeleteHasNoDestination(t *testing.T)
func TestPlanMkdirDetectsExistingPath(t *testing.T)
```

- [ ] **步骤 2：编写执行器测试**

创建 `internal/ops/executor_test.go`，包含使用临时目录的测试：

```go
func TestExecutorCopiesFile(t *testing.T)
func TestExecutorMovesFile(t *testing.T)
func TestExecutorCreatesSymlink(t *testing.T)
func TestExecutorCreatesHardLink(t *testing.T)
func TestExecutorDeletesFile(t *testing.T)
func TestExecutorCopiesDirectoryRecursively(t *testing.T)
```

只有当 `os.Link` 返回能够证明临时文件系统不支持硬链接的平台或文件系统错误时，才用 `t.Skip` 跳过硬链接测试。

- [ ] **步骤 3：定义操作类型**

创建 `internal/ops/types.go`:

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

- [ ] **步骤 4：实现规划器**

创建 `internal/ops/planner.go`:

```go
type Planner struct {
	Resolver roots.Resolver
}

func (p Planner) Plan(ctx context.Context, req Request) (Plan, error)
```

规则：

- 对写操作使用的每个源路径和目标路径都调用 `Resolver.ResolveForWrite`。
- 对 move/copy/symlink/hardlink，目标是 `DestPath + base(source)`。
- 对 mkdir，目标是 `DestPath + NewName`。
- 目标已存在时标记冲突。
- 用 `ErrorCode: "hardlink_directory"` 标记对目录创建硬链接的请求。
- 用 `ErrorCode: "missing_source"` 标记缺失源路径。
- 不要覆盖。

- [ ] **步骤 5：实现执行器**

创建 `internal/ops/executor.go`:

```go
type Executor struct {
	Resolver roots.Resolver
}

func (e Executor) Execute(ctx context.Context, item PlanItem) error
```

实现：

- `move`：`os.Rename`。
- `copy`：递归复制，并为常规文件和目录保留文件模式。
- `symlink`：使用解析后的源绝对路径调用 `os.Symlink`。
- `hardlink`：对常规文件调用 `os.Link`。
- `delete`：`os.RemoveAll`。
- `mkdir`：`os.Mkdir`。

在每个条目前以及递归复制期间检查 `ctx.Err()`。

- [ ] **步骤 6：运行测试并提交**

运行：

```bash
gofmt -w internal/ops
go test ./internal/ops ./internal/roots
git add internal/ops
git commit -m "feat: add file operation planner"
```

预期：测试通过，并且提交成功。

---

### 任务 8：作业存储、Runner、取消和审计记录

**文件：**
- 创建： `internal/jobs/types.go`
- 创建： `internal/jobs/store.go`
- 创建： `internal/jobs/runner.go`
- 创建： `internal/audit/audit.go`
- 测试： `internal/jobs/runner_test.go`
- 测试： `internal/jobs/store_test.go`

- [ ] **步骤 1：编写作业存储测试**

创建 `internal/jobs/store_test.go`，包含以下测试：

```go
func TestCreateAndLoadJob(t *testing.T)
func TestAppendJobItemResults(t *testing.T)
func TestRequestCancelMarksJob(t *testing.T)
func TestListJobsReturnsNewestFirst(t *testing.T)
```

- [ ] **步骤 2：编写 runner 测试**

创建 `internal/jobs/runner_test.go`，包含一个假 executor 和以下测试：

```go
func TestRunnerCompletesSuccessfulJob(t *testing.T)
func TestRunnerRecordsItemFailureAndContinues(t *testing.T)
func TestRunnerStopsAfterCancelRequest(t *testing.T)
func TestRunnerWritesAuditRecordForCompletedItem(t *testing.T)
```

- [ ] **步骤 3：定义作业类型**

创建 `internal/jobs/types.go`:

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

- [ ] **步骤 4：实现作业存储**

创建 `internal/jobs/store.go`，包含以下方法：

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

- [ ] **步骤 5：实现审计存储**

创建 `internal/audit/audit.go`:

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

- [ ] **步骤 6：实现 runner**

创建 `internal/jobs/runner.go`:

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

Runner 规则：

- 执行条目前先将作业标记为 running。
- 每个条目前检查取消状态。
- 记录每个条目的成功或失败。
- 条目失败后继续执行。
- 为每个成功条目插入一条审计记录。
- 以 completed、completed with errors、canceled 或 failed 结束。

- [ ] **步骤 7：运行测试并提交**

运行：

```bash
gofmt -w internal/jobs internal/audit
go test ./internal/jobs ./internal/audit ./internal/store
git add internal/jobs internal/audit
git commit -m "feat: add background job runner"
```

预期：测试通过，并且提交成功。

---

### 任务 9：REST 路由器和后端 API 串接

**文件：**
- 创建： `internal/web/respond.go`
- 创建： `internal/web/errors.go`
- 创建： `internal/web/router.go`
- 创建： `internal/jobs/handlers.go`
- 修改： `cmd/filebutler/main.go`
- 测试： `internal/web/router_test.go`

- [ ] **步骤 1：编写路由器测试**

创建 `internal/web/router_test.go`，包含 `httptest` 用例：

```go
func TestHealthEndpoint(t *testing.T)
func TestInitStatusEndpoint(t *testing.T)
func TestProtectedRoutesRequireLogin(t *testing.T)
func TestCreateAdminThenLoginThenMe(t *testing.T)
func TestRootsEndpointReturnsConfiguredRoots(t *testing.T)
func TestBrowseEndpointReturnsEntries(t *testing.T)
```

- [ ] **步骤 2：实现 JSON 响应辅助函数**

创建 `internal/web/respond.go`:

```go
func Data(w http.ResponseWriter, status int, value any)
func Error(w http.ResponseWriter, status int, code string, message string)
func DecodeJSON(r *http.Request, dst any) error
```

创建 `internal/web/errors.go`，包含一个带类型的 API 错误：

```go
type APIError struct {
	Status  int
	Code    string
	Message string
}
```

- [ ] **步骤 3：实现路由器依赖和路由**

创建 `internal/web/router.go`:

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

路由：

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

除健康检查、初始化状态、创建管理员和登录外，受保护路由必须使用认证中间件。

- [ ] **步骤 4：实现作业处理器**

创建 `internal/jobs/handlers.go`：

```go
func ListHandler(store Store) http.HandlerFunc
func GetHandler(store Store) http.HandlerFunc
func CancelHandler(store Store) http.HandlerFunc
```

- [ ] **步骤 5：更新 main 以使用真实依赖**

修改 `cmd/filebutler/main.go` 以：

- 加载配置。
- 打开 SQLite。
- 根据配置根目录构建 root resolver。
- 构造服务。
- 启动 `web.NewRouter`。

- [ ] **步骤 6：运行测试并提交**

运行：

```bash
gofmt -w cmd internal/web internal/jobs
go test ./...
git add cmd internal/web internal/jobs
git commit -m "feat: wire backend api router"
```

预期：所有后端测试通过，并且提交成功。

---

### 任务 10：操作和重命名的后端作业创建端点

**文件：**
- 修改： `internal/web/router.go`
- 创建： `internal/ops/handlers.go`
- 创建： `internal/rename/handlers.go`
- 测试： `internal/ops/handlers_test.go`
- 测试： `internal/rename/handlers_test.go`

- [ ] **步骤 1：编写处理器测试**

创建以下测试：

```go
func TestOpsDryRunReturnsPlan(t *testing.T)
func TestOpsCreateJobPersistsPendingJob(t *testing.T)
func TestRenamePreviewReturnsNaturalSortedPlan(t *testing.T)
func TestRenameCreateJobRejectsConflictingPlan(t *testing.T)
```

- [ ] **步骤 2：实现操作处理器**

创建 `internal/ops/handlers.go`：

```go
func DryRunHandler(planner Planner) http.HandlerFunc
func CreateJobHandler(planner Planner, store jobs.Store, runner jobs.Runner) http.HandlerFunc
```

创建作业处理器必须：

- 在服务端重新计算 dry-run 计划。
- 拒绝有冲突的计划。
- 持久化一个带 plan JSON 的 pending 作业。
- 在 goroutine 中启动 runner。
- 返回作业 ID。

- [ ] **步骤 3：实现重命名处理器**

创建 `internal/rename/handlers.go`：

```go
func PreviewHandler(browser browser.Service) http.HandlerFunc
func CreateJobHandler(browser browser.Service, store jobs.Store, runner jobs.Runner) http.HandlerFunc
```

预览处理器必须：

- 接受 root id、选中的相对路径和重命名选项。
- 加载选中路径的元数据。
- 生成重命名计划。
- 返回冲突和条目。

创建作业处理器必须拒绝冲突，并持久化一个可运行作业。

- [ ] **步骤 4：接入路由**

修改 `internal/web/router.go` 添加：

- `POST /api/ops/jobs`
- `POST /api/rename/jobs`

- [ ] **步骤 5：运行测试并提交**

运行：

```bash
gofmt -w internal/ops internal/rename internal/web
go test ./...
git add internal/ops internal/rename internal/web
git commit -m "feat: add operation job endpoints"
```

预期：测试通过，并且提交成功。

---

### 任务 11：前端脚手架、API 客户端和测试框架

**文件：**
- 创建： `web/package.json`
- 创建： `web/index.html`
- 创建： `web/vite.config.ts`
- 创建： `web/tsconfig.json`
- 创建： `web/src/main.tsx`
- 创建： `web/src/App.tsx`
- 创建： `web/src/api/client.ts`
- 创建： `web/src/api/types.ts`
- 创建： `web/src/test/setup.ts`
- 创建： `web/src/styles.css`

- [ ] **步骤 1：创建 Vite React 应用文件**

运行：

```bash
npm create vite@latest web -- --template react-ts
cd web
npm install
npm install -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom playwright
cd ..
```

预期：`web/package.json` 存在，并且在最小应用修改后可以运行 `npm --prefix web run build`。

- [ ] **步骤 2：定义 API 类型**

创建 `web/src/api/types.ts`:

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

- [ ] **步骤 3：实现 API 客户端**

创建 `web/src/api/client.ts`:

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

- [ ] **步骤 4：配置 Vitest**

更新 `web/vite.config.ts`，让 `test.environment` 为 `jsdom`，setup 文件为 `web/src/test/setup.ts`。创建 setup：

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **步骤 5：运行前端测试并提交**

运行：

```bash
npm --prefix web run build
npm --prefix web run test -- --run
git add web
git commit -m "feat: scaffold frontend app"
```

预期：构建和测试通过，提交成功。

---

### 任务 12：初始化和登录 UI

**文件：**
- 修改： `web/src/App.tsx`
- 创建： `web/src/components/InitScreen.tsx`
- 创建： `web/src/components/LoginScreen.tsx`
- 创建： `web/src/components/ErrorBanner.tsx`
- 测试： `web/src/components/InitScreen.test.tsx`
- 测试： `web/src/components/LoginScreen.test.tsx`

- [ ] **步骤 1：编写组件测试**

测试用例：

```ts
it("submits custom admin username and password from InitScreen")
it("shows validation message for short password in InitScreen")
it("submits login credentials from LoginScreen")
it("shows API errors in LoginScreen")
```

使用 Vitest mock `api.createAdmin` 和 `api.login`。

- [ ] **步骤 2：实现 `ErrorBanner`**

创建一个紧凑组件：

```tsx
export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="error-banner" role="alert">{message}</div>;
}
```

- [ ] **步骤 3：实现 `InitScreen`**

字段：

- 用户名。
- 密码。
- 确认密码。

客户端校验：

- 用户名不能为空。
- 密码长度至少为 10。
- 确认密码必须匹配。

- [ ] **步骤 4：实现 `LoginScreen`**

字段：

- 用户名。
- 密码。

成功后调用 `onLoggedIn`。

- [ ] **步骤 5：更新 `App` 启动流程**

`App` 流程：

1. 调用 `/api/init/status`。
2. 如果需要初始化，显示 `InitScreen`。
3. 否则调用 `/api/auth/me`。
4. 如果已认证，显示主应用 shell。
5. 如果未认证，显示 `LoginScreen`。

- [ ] **步骤 6：运行测试并提交**

运行：

```bash
npm --prefix web run test -- --run
npm --prefix web run build
git add web/src
git commit -m "feat: add init and login screens"
```

预期：测试和构建通过。

---

### 任务 13：双栏文件浏览器 UI

**文件：**
- 创建： `web/src/components/DualPane.tsx`
- 创建： `web/src/components/FilePane.tsx`
- 修改： `web/src/App.tsx`
- 修改： `web/src/styles.css`
- 测试： `web/src/components/FilePane.test.tsx`
- 测试： `web/src/components/DualPane.test.tsx`

- [ ] **步骤 1：编写浏览器组件测试**

测试用例：

```ts
it("loads roots and renders two panes")
it("loads entries when a root is selected")
it("supports selecting and clearing file selections")
it("navigates into a directory")
it("renders symlink target metadata")
```

- [ ] **步骤 2：实现 `FilePane`**

属性：

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

UI 要求：

- 根目录选择器。
- 当前路径面包屑使用文本按钮。
- 刷新图标按钮；如果没有图标库，则使用文本回退。
- 文件表格包含名称、类型、大小和修改时间。
- 使用复选框选择。
- 目录行双击进入。

- [ ] **步骤 3：实现 `DualPane` 状态**

状态：

- 左侧根目录和路径。
- 右侧根目录和路径。
- 左侧条目和右侧条目。
- 左侧选择和右侧选择。
- 活动面板。

挂载时加载根目录，并独立浏览每个面板。

- [ ] **步骤 4：应用实用型布局 CSS**

使用紧凑的应用布局：

- 全高度 shell。
- 顶部工具栏。
- 两个等宽面板，中间用看起来可调整大小的分隔条隔开。
- 稳定的行高。
- 不使用嵌套卡片。
- 按钮尺寸紧凑且可预测。

- [ ] **步骤 5：运行测试并提交**

运行：

```bash
npm --prefix web run test -- --run
npm --prefix web run build
git add web/src
git commit -m "feat: add dual pane browser"
```

预期：测试和构建通过。

---

### 任务 14：操作预览和作业进度 UI

**文件：**
- 创建： `web/src/components/OperationPreview.tsx`
- 创建： `web/src/components/JobsPanel.tsx`
- 修改： `web/src/api/client.ts`
- 修改： `web/src/api/types.ts`
- 修改： `web/src/components/DualPane.tsx`
- 测试： `web/src/components/OperationPreview.test.tsx`
- 测试： `web/src/components/JobsPanel.test.tsx`

- [ ] **步骤 1：扩展 API 客户端**

添加客户端方法：

```ts
opsDryRun(request: OpsRequest): Promise<{ items: PlanItem[]; hasConflict: boolean }>
opsCreateJob(request: OpsRequest): Promise<{ id: string }>
job(id: string): Promise<Job & { items: PlanItem[] }>
cancelJob(id: string): Promise<{ id: string }>
```

- [ ] **步骤 2：编写 UI 测试**

测试用例：

```ts
it("shows conflicts in operation preview and disables confirmation")
it("creates a job from a conflict-free operation plan")
it("polls job progress and renders completed status")
it("sends cancel request for a running job")
```

- [ ] **步骤 3：在 `DualPane` 中实现操作工具栏**

命令：

- 将选中项移动到对侧面板。
- 将选中项复制到对侧面板。
- 将选中项软链接到对侧面板。
- 将选中项硬链接到对侧面板。
- 删除选中项。
- 在活动面板中创建目录。

所有破坏性或批量命令在创建作业前都打开 `OperationPreview`。

- [ ] **步骤 4：实现 `OperationPreview`**

显示内容：

- 操作类型。
- 源路径。
- 目标路径。
- 冲突徽标。
- 错误文本。
- 当 `hasConflict` 为 true 时禁用确认按钮。

- [ ] **步骤 5：实现 `JobsPanel`**

轮询行为：

- 面板打开时每 2 秒轮询 `/api/jobs`。
- 如果状态为 running 或 cancel requested，每 1 秒轮询选中作业详情。
- 对 completed、failed 和 canceled 状态停止详情轮询。

- [ ] **步骤 6：运行测试并提交**

运行：

```bash
npm --prefix web run test -- --run
npm --prefix web run build
git add web/src
git commit -m "feat: add operation preview and jobs ui"
```

预期：测试和构建通过。

---

### 任务 15：重命名工作流 UI

**文件：**
- 创建： `web/src/components/RenameDialog.tsx`
- 修改： `web/src/api/client.ts`
- 修改： `web/src/api/types.ts`
- 修改： `web/src/components/DualPane.tsx`
- 测试： `web/src/components/RenameDialog.test.tsx`

- [ ] **步骤 1：为重命名扩展 API 客户端**

添加方法：

```ts
renamePreview(request: RenameRequest): Promise<{ items: PlanItem[]; hasConflict: boolean }>
renameCreateJob(request: RenameRequest): Promise<{ id: string }>
```

定义 `RenameRequest`：

```ts
type RenameRequest = {
  rootId: string;
  paths: string[];
  options: RenameOptions;
};
```

- [ ] **步骤 2：编写重命名对话框测试**

测试用例：

```ts
it("requests preview when rename options change")
it("shows original and renamed values")
it("disables run button when preview has conflicts")
it("creates a rename job from selected files")
it("keeps enumerate option visible with a checkbox")
```

- [ ] **步骤 3：实现 `RenameDialog`**

控件：

- 搜索输入框。
- 替换输入框。
- 正则复选框。
- 区分大小写复选框。
- 全部匹配复选框。
- 目标分段控件：名称、扩展名、两者。
- 包含文件复选框。
- 包含文件夹复选框。
- 包含子文件夹复选框。
- 枚举复选框。

预览表：

- 源路径。
- 旧名称。
- 新名称。
- 冲突或错误。

- [ ] **步骤 4：将重命名命令接入 `DualPane`**

添加一个工具栏命令，为活动面板中的选中项打开 `RenameDialog`。作业创建后关闭对话框，并打开或刷新 `JobsPanel`。

- [ ] **步骤 5：运行测试并提交**

运行：

```bash
npm --prefix web run test -- --run
npm --prefix web run build
git add web/src
git commit -m "feat: add batch rename ui"
```

预期：测试和构建通过。

---

### 任务 16：静态资源服务、Docker、本地部署和端到端检查

**文件：**
- 创建： `internal/web/static.go`
- 创建： `Dockerfile`
- 创建： `.dockerignore`
- 创建： `README.md`
- 修改： `cmd/filebutler/main.go`
- 修改： `web/package.json`
- 测试： `web/e2e/filebutler.spec.ts`

- [ ] **步骤 1：实现前端静态资源服务**

创建 `internal/web/static.go`:

```go
func StaticHandler(distDir string) http.Handler
```

规则：

- 从 `web/dist` 或已配置的静态目录提供文件。
- 对非 API 路径返回 `index.html`，以便 React 路由工作。
- 绝不拦截以 `/api/` 开头的路径。

修改 `cmd/filebutler/main.go`，在 API 路由之后挂载静态处理器。

- [ ] **步骤 2：添加 Dockerfile**

创建一个多阶段 `Dockerfile`：

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

创建 `.dockerignore`：

```text
.git
web/node_modules
web/dist
data
```

- [ ] **步骤 3：添加 README 部署说明**

创建 `README.md`，内容包括：

- 项目用途。
- Linux 本地构建命令：`go build -o bin/filebutler ./cmd/filebutler`。
- 前端构建命令：`npm --prefix web ci && npm --prefix web run build`。
- Docker 构建命令：`docker build -t filebutler:local .`。
- 包含挂载 `/data/downloads`、`/data/media` 和 `/app/data` 的 Docker run 示例命令。
- 首次运行管理员初始化流程。
- 安全警告：使用 HTTPS 反向代理，不要将服务直接暴露到公网。

- [ ] **步骤 4：添加 Playwright 端到端冒烟测试**

创建 `web/e2e/filebutler.spec.ts`，覆盖：

```ts
test("initializes admin, logs in, and sees two file panes")
```

使用正在运行的本地服务器。测试应当：

- 访问 `/`。
- 如果出现初始化页面，则创建管理员。
- 登录。
- 断言左右两个面板可见。

- [ ] **步骤 5：运行完整验证**

运行：

```bash
gofmt -w cmd internal
go test ./...
npm --prefix web run test -- --run
npm --prefix web run build
go build -o /tmp/filebutler ./cmd/filebutler
docker build -t filebutler:local .
```

预期：

- 后端测试通过。
- 前端测试通过。
- 前端构建成功。
- Go 二进制构建通过。
- Docker 镜像构建通过。

- [ ] **步骤 6：提交最终 MVP 脚手架**

运行：

```bash
git add Dockerfile .dockerignore README.md cmd internal web configs go.mod go.sum
git commit -m "feat: add deployable filebutler mvp"
```

预期：提交成功。

---

## 最终验证清单

任务 16 后运行：

```bash
git status --short --branch
go test ./...
npm --prefix web run test -- --run
npm --prefix web run build
go build -o /tmp/filebutler ./cmd/filebutler
docker build -t filebutler:local .
```

预期：

- `git status --short --branch` 在最终提交后显示当前分支且没有未暂存文件。
- Go 测试通过。
- 前端测试通过。
- 前端构建通过。
- Linux 二进制构建通过。
- Docker 镜像构建通过。

## 规格覆盖映射

- Docker 部署：任务 16。
- Linux 本地二进制部署：任务 1 和 16。
- 首次运行管理员初始化：任务 3、9 和 12。
- 管理员登录：任务 3、9 和 12。
- 多个存储根目录：任务 1、4、9 和 13。
- 双栏 Web UI：任务 13。
- 根目录边界内的目录浏览：任务 4、5、9 和 13。
- 移动、复制、软链接、硬链接、创建目录和删除：任务 7、10 和 14。
- Dry-run 预览：任务 7、10 和 14。
- 带进度、取消、失败和审计日志的后台作业：任务 8、9、10 和 14。
- PowerRename 风格批量重命名：任务 6、10 和 15。
- Windows Explorer 风格自然排序：任务 5 和 6。
- SQLite 持久化：任务 2、3 和 8。
- 会话安全和部署警告：任务 3 和 16。

## 实现契约

在所有任务中一致使用这些契约。当实现细节看起来冲突时，除非后续任务用测试明确更新，否则以本节为准。

### JSON 包装格式

成功响应：

```json
{
  "data": {}
}
```

错误响应：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "human readable message"
  }
}
```

### 认证载荷

`GET /api/init/status` 返回：

```json
{
  "data": {
    "needsInitialization": true
  }
}
```

`POST /api/init/admin` 接受：

```json
{
  "username": "admin",
  "password": "long-password"
}
```

并返回：

```json
{
  "data": {
    "id": 1,
    "username": "admin"
  }
}
```

`POST /api/auth/login` 接受相同的用户名和密码载荷，设置会话 cookie，并返回相同的用户形状。

`GET /api/auth/me` 返回当前用户：

```json
{
  "data": {
    "id": 1,
    "username": "admin"
  }
}
```

### 根目录与浏览载荷

`GET /api/roots` 返回：

```json
{
  "data": [
    { "id": "downloads", "name": "Downloads" }
  ]
}
```

不要向前端返回根目录绝对路径。

`GET /api/browse?rootId=downloads&path=.` 返回：

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

### 操作载荷

操作 dry-run 和 create-job 端点接受：

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

`type` 取值为 `move`、`copy`、`symlink`、`hardlink`、`delete` 和 `mkdir`。

Dry-run 返回：

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

Create-job 返回：

```json
{
  "data": {
    "id": "job_1781961600000000000_abcd"
  }
}
```

### 重命名载荷

重命名 preview 和 create-job 端点接受：

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

Preview 返回：

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

### 作业载荷

`GET /api/jobs` 返回最新作业在前的列表：

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

`GET /api/jobs/{id}` 返回作业详情：

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

作业状态取值：

```text
pending
running
cancel_requested
completed
completed_with_errors
failed
canceled
```

### 审计载荷

`GET /api/audit` 返回最新审计记录在前的列表：

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

### 错误码

在后端计划和 API 错误中使用这些字符串代码：

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

### 前端测试 Mock

除 API 客户端测试外，前端单元测试应 mock API 方法，而不是直接 mock `fetch`。使用此模式：

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

测试作业轮询计时时，使用：

```ts
vi.useFakeTimers();
await act(async () => {
  vi.advanceTimersByTime(2000);
});
vi.useRealTimers();
```

### 提交纪律

每个任务都以一次提交结束。如果某个任务需要通过 `go get`、`npm install` 或 Docker 基础镜像拉取访问网络，请为该命令请求批准，并保持命令与任务中写的一致。
