package storage

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/little6neko/filebutler/internal/roots"
)

func localHash(resolver roots.Resolver, path string, info os.FileInfo) (Hash, error) {
	mapped, err := resolver.MapPath(path)
	if err != nil {
		return Hash{}, err
	}
	return Hash{Scope: LocalScope(mapped.Root.ID, mapped.Root.Path), Path: filepath.ToSlash(mapped.Rel), Version: LocalVersion(info)}, nil
}

type retainedHash struct {
	hash   Hash
	suffix string
	info   os.FileInfo
}

// Capture only existing database records, not a directory walk or content read.
func (s *Store) captureLocal(ctx context.Context, resolver roots.Resolver, source string) ([]retainedHash, error) {
	mapped, err := resolver.MapPath(source)
	if err != nil {
		return nil, err
	}
	scope, rel := LocalScope(mapped.Root.ID, mapped.Root.Path), filepath.ToSlash(mapped.Rel)
	prefix := strings.TrimSuffix(rel, "/") + "/"
	rows, err := s.DB.QueryContext(ctx, `SELECT path,version,sha1,origin FROM file_hashes WHERE scope=? AND (path=? OR substr(path,1,?)=?)`, scope, rel, len([]rune(prefix)), prefix)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []retainedHash
	for rows.Next() {
		h := Hash{Scope: scope}
		if err := rows.Scan(&h.Path, &h.Version, &h.SHA1, &h.Origin); err != nil {
			return nil, err
		}
		suffix := ""
		if h.Path != rel {
			suffix = strings.TrimPrefix(h.Path, prefix)
		}
		info, err := FreshLocalInfo(filepath.Join(source, filepath.FromSlash(suffix)))
		if err == nil && LocalVersion(info) != "" && LocalVersion(info) == h.Version {
			records = append(records, retainedHash{hash: h, suffix: suffix, info: info})
		}
	}
	return records, rows.Err()
}

// RenameLocal follows successful, backend-owned renames (including staging and
// rollback). Cache failures must never turn a completed rename into a retry.
func (s *Store) RenameLocal(ctx context.Context, resolver roots.Resolver, source, destination string, rename func(string, string) error) error {
	if s == nil || filepath.Clean(source) == filepath.Clean(destination) {
		return rename(source, destination)
	}
	records, cacheErr := s.captureLocal(ctx, resolver, source)
	if err := rename(source, destination); err != nil {
		return err
	}
	// Keep these updates independent of task cancellation after a successful move.
	ctx = context.WithoutCancel(ctx)
	var invalidated, retained []Hash
	for _, path := range []string{source, destination} {
		if mapped, err := resolver.MapPath(path); err == nil {
			invalidated = append(invalidated, Hash{Scope: LocalScope(mapped.Root.ID, mapped.Root.Path), Path: filepath.ToSlash(mapped.Rel)})
		}
	}
	for _, record := range records {
		path := filepath.Join(destination, filepath.FromSlash(record.suffix))
		info, err := FreshLocalInfo(path)
		// Rebind only the same regular file. Rename changes ctime, not content;
		// a raced-in replacement must not inherit the original file's digest.
		if err != nil || !info.Mode().IsRegular() || !os.SameFile(record.info, info) || info.Size() != record.info.Size() || !info.ModTime().Equal(record.info.ModTime()) {
			continue
		}
		h, err := localHash(resolver, path, info)
		if err != nil {
			cacheErr = err
			continue
		}
		h.SHA1, h.Origin = record.hash.SHA1, record.hash.Origin
		retained = append(retained, h)
	}
	if err := s.replaceLocalHashes(ctx, invalidated, retained); err != nil {
		cacheErr = err
	}
	if cacheErr != nil {
		log.Print("file hash cache could not follow rename")
	}
	return nil
}

// CopyLocal reuses the source digest after the copy loop has checked its source
// metadata. No digest is generated for an uncached file and no bytes are reread.
func (s *Store) CopyLocal(ctx context.Context, resolver roots.Resolver, source, destination string, before os.FileInfo) {
	if s == nil {
		return
	}
	h, err := localHash(resolver, source, before)
	if err != nil || h.Version == "" {
		return
	}
	digest, err := s.Hash(ctx, h)
	if err != nil {
		log.Print("file hash cache could not be read after copy")
		return
	}
	info, err := FreshLocalInfo(destination)
	if err != nil || !info.Mode().IsRegular() || info.Size() != before.Size() {
		return
	}
	h, err = localHash(resolver, destination, info)
	if err != nil {
		return
	}
	h.SHA1, h.Origin = digest, "copy"
	var retained []Hash
	if digest != "" {
		retained = append(retained, h)
	}
	if err := s.replaceLocalHashes(ctx, []Hash{h}, retained); err != nil {
		log.Print("file hash cache could not follow copy")
	}
}

// One transaction per operation, including an entire renamed directory. Avoid
// one SQLite durable commit for every cached descendant.
func (s *Store) replaceLocalHashes(ctx context.Context, invalidated, retained []Hash) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, h := range invalidated {
		if err := invalidateHashes(ctx, tx, h.Scope, h.Path); err != nil {
			return err
		}
	}
	for _, h := range retained {
		if err := putHash(ctx, tx, h); err != nil {
			return err
		}
	}
	return tx.Commit()
}
