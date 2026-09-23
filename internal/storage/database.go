// Package storage owns FileButler's private persistent data.
package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

type Store struct {
	DB   *sql.DB
	Path string
}

const schema = `
CREATE TABLE users (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
CREATE TABLE internal_settings (key TEXT PRIMARY KEY, value BLOB NOT NULL);
CREATE TABLE cloud_credentials (provider TEXT PRIMARY KEY CHECK(provider='115'), cookie TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
CREATE TABLE file_hashes (scope TEXT NOT NULL, path TEXT NOT NULL, version TEXT NOT NULL, sha1 TEXT NOT NULL CHECK(length(sha1)=40), origin TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(scope,path));
CREATE INDEX file_hashes_sha1 ON file_hashes(sha1);
PRAGMA user_version=1;`

func Open(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("database path is empty")
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	if info, e := os.Lstat(path); e == nil && !info.Mode().IsRegular() {
		return nil, errors.New("database must be a regular file")
	} else if e != nil && !errors.Is(e, os.ErrNotExist) {
		return nil, e
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	empty := info.Size() == 0
	err = file.Chmod(0600)
	file.Close()
	if err != nil {
		return nil, err
	}
	uri := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	db, err := sql.Open("sqlite", uri.String()+"?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	fail := func(e error) (*Store, error) { db.Close(); return nil, e }
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fail(errors.New("invalid database"))
	}
	if empty {
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		if _, e = tx.Exec(schema); e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	} else if version != 1 {
		return fail(fmt.Errorf("unsupported database version %d", version))
	}
	var check string
	if err = db.QueryRow("PRAGMA quick_check").Scan(&check); err != nil || check != "ok" {
		return fail(errors.New("database integrity check failed"))
	}
	// Validate required columns even for a database with a forged version number.
	for _, query := range []string{"SELECT id,username,password_hash FROM users LIMIT 0", "SELECT key,value FROM internal_settings LIMIT 0", "SELECT provider,cookie,account_id,updated_at FROM cloud_credentials LIMIT 0", "SELECT scope,path,version,sha1,origin,updated_at FROM file_hashes LIMIT 0"} {
		rows, e := db.Query(query)
		if e != nil {
			return fail(errors.New("invalid database schema"))
		}
		rows.Close()
	}
	if _, err = db.Exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;"); err != nil {
		return fail(err)
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if e := os.Chmod(path+suffix, 0600); e != nil && !errors.Is(e, os.ErrNotExist) {
			return fail(e)
		}
	}
	return &Store{DB: db, Path: path}, nil
}
func (s *Store) Close() error { return s.DB.Close() }

type Admin struct {
	Username, PasswordHash string
	SigningKey             []byte
}

var ErrInitialized = errors.New("already initialized")

func (s *Store) Admin(ctx context.Context) (*Admin, error) {
	var a Admin
	err := s.DB.QueryRowContext(ctx, "SELECT username,password_hash FROM users WHERE id=1").Scan(&a.Username, &a.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		var n int
		err = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM internal_settings WHERE key='signing_key'").Scan(&n)
		if err == nil && n != 0 {
			return nil, errors.New("incomplete authentication record")
		}
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	err = s.DB.QueryRowContext(ctx, "SELECT value FROM internal_settings WHERE key='signing_key'").Scan(&a.SigningKey)
	return &a, err
}
func (s *Store) CreateAdmin(ctx context.Context, a Admin) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, "INSERT INTO users(id,username,password_hash) VALUES(1,?,?) ON CONFLICT(id) DO NOTHING", a.Username, a.PasswordHash)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrInitialized
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO internal_settings(key,value) VALUES('signing_key',?)", a.SigningKey); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Cookie(ctx context.Context) (string, error) {
	var cookie string
	err := s.DB.QueryRowContext(ctx, "SELECT cookie FROM cloud_credentials WHERE provider='115'").Scan(&cookie)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return cookie, err
}
func (s *Store) SetCookie(ctx context.Context, cookie string) error {
	if !strings.Contains(cookie, "UID=") || len(cookie) > 65536 {
		return errors.New("invalid credential")
	}
	account := ""
	for _, part := range strings.Split(cookie, ";") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(part), "UID="); ok {
			account = strings.SplitN(value, "_", 2)[0]
			break
		}
	}
	_, err := s.DB.ExecContext(ctx, "INSERT INTO cloud_credentials(provider,cookie,account_id,updated_at) VALUES('115',?,?,unixepoch()) ON CONFLICT(provider) DO UPDATE SET cookie=excluded.cookie, account_id=excluded.account_id,updated_at=excluded.updated_at", cookie, account)
	return err
}
func (s *Store) DeleteCookie(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, "DELETE FROM cloud_credentials WHERE provider='115'")
	return err
}
