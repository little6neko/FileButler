package storage

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"log"
	"path/filepath"
	"strings"
	"time"
)

type Hash struct {
	Scope   string `json:"scope"`
	Path    string `json:"path"`
	Version string `json:"version"`
	SHA1    string `json:"sha1"`
	Origin  string `json:"origin"`
}

func (s *Store) Hash(ctx context.Context, h Hash) (string, error) {
	var value, version string
	err := s.DB.QueryRowContext(ctx, "SELECT version,sha1 FROM file_hashes WHERE scope=? AND path=?", h.Scope, h.Path).Scan(&version, &value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if version != h.Version {
		_, err = s.DB.ExecContext(ctx, "DELETE FROM file_hashes WHERE scope=? AND path=? AND version=?", h.Scope, h.Path, version)
		return "", err
	}
	return value, nil
}
func (s *Store) PutHash(ctx context.Context, h Hash) error {
	bytes, err := hex.DecodeString(h.SHA1)
	if err != nil || len(bytes) != 20 || h.Scope == "" || h.Path == "" || h.Version == "" {
		return errors.New("invalid hash record")
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO file_hashes(scope,path,version,sha1,origin,updated_at) VALUES(?,?,?,?,?,unixepoch())
 ON CONFLICT(scope,path) DO UPDATE SET version=excluded.version,sha1=excluded.sha1,origin=excluded.origin,updated_at=excluded.updated_at`, h.Scope, h.Path, h.Version, strings.ToUpper(h.SHA1), h.Origin)
	return err
}
func (s *Store) Invalidate(ctx context.Context, scope, path string) error {
	if path == "." || path == "" {
		_, err := s.DB.ExecContext(ctx, "DELETE FROM file_hashes WHERE scope=?", scope)
		return err
	}
	prefix := strings.TrimSuffix(filepath.ToSlash(path), "/") + "/"
	_, err := s.DB.ExecContext(ctx, "DELETE FROM file_hashes WHERE scope=? AND (path=? OR substr(path,1,?)=?)", scope, filepath.ToSlash(path), len([]rune(prefix)), prefix)
	return err
}

// Local invalidation is deliberately conservative. It never adds a content read.
func (s *Store) InvalidateLocal(rootID, rootPath, path string) {
	if s == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Invalidate(ctx, LocalScope(rootID, rootPath), filepath.ToSlash(path)); err != nil {
		log.Print("file hash cache invalidation failed")
	}
}
func LocalScope(rootID, rootPath string) string {
	if actual, err := filepath.EvalSymlinks(rootPath); err == nil {
		rootPath = actual
	}
	return "local:" + rootID + ":" + filepath.Clean(rootPath)
}
