package textfile

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
)

type Service struct {
	Cache       *storage.Store
	resolver    roots.Resolver
	locks       pathLocks
	atomicWrite func(path string, content []byte, mode fs.FileMode) error
}

func NewService(resolver roots.Resolver) *Service {
	return &Service{
		resolver:    resolver,
		locks:       newPathLocks(),
		atomicWrite: atomicReplace,
	}
}

func (s *Service) Read(rootID, path string) (Document, error) {
	if !IsSupported(path) {
		return Document{}, ErrUnsupportedText
	}
	resolved, err := s.resolver.ResolveFollow(rootID, path)
	if err != nil {
		return Document{}, normalizeFileError(err)
	}
	return readDocument(resolved.Actual.Abs)
}

func (s *Service) Save(request SaveRequest) (SaveResult, error) {
	if !IsSupported(request.Path) {
		return SaveResult{}, ErrUnsupportedText
	}
	initial, err := s.resolver.ResolveFollow(request.RootID, request.Path)
	if err != nil {
		return SaveResult{}, normalizeFileError(err)
	}
	key := filepath.Clean(initial.Actual.Abs)
	unlock := s.locks.lock(key)
	defer unlock()

	resolved, err := s.resolver.ResolveFollow(request.RootID, request.Path)
	if err != nil {
		return SaveResult{}, normalizeFileError(err)
	}
	if filepath.Clean(resolved.Actual.Abs) != key {
		return SaveResult{}, ErrTargetChanged
	}

	raw, mode, err := readRawRegular(resolved.Actual.Abs)
	if err != nil {
		return SaveResult{}, err
	}
	if _, err := DecodeText(raw); err != nil {
		return SaveResult{}, fmt.Errorf("%w: %w", ErrUnsupportedText, err)
	}
	currentRevision := Revision(raw)
	if !request.Force && request.Revision != currentRevision {
		return SaveResult{}, ErrRevisionConflict
	}

	encoded, err := EncodeText(request.Content, request.Encoding, request.LineEnding)
	if err != nil {
		return SaveResult{}, err
	}
	if int64(len(encoded)) > MaxFileSize {
		return SaveResult{}, ErrTooLarge
	}
	s.Cache.InvalidateLocal(resolved.Actual.Root.ID, resolved.Actual.Root.Path, resolved.Actual.Rel)
	defer s.Cache.InvalidateLocal(resolved.Actual.Root.ID, resolved.Actual.Root.Path, resolved.Actual.Rel)
	if err := s.atomicWrite(resolved.Actual.Abs, encoded, mode); err != nil {
		return SaveResult{}, err
	}
	return SaveResult{ByteSize: int64(len(encoded)), Revision: Revision(encoded)}, nil
}

func readDocument(path string) (Document, error) {
	raw, _, err := readRawRegular(path)
	if err != nil {
		return Document{}, err
	}
	decoded, err := DecodeText(raw)
	if err != nil {
		return Document{}, fmt.Errorf("%w: %w", ErrUnsupportedText, err)
	}
	return Document{
		Content:             decoded.Content,
		Encoding:            decoded.Encoding,
		LineEnding:          decoded.LineEnding,
		PreferredLineEnding: decoded.PreferredLineEnding,
		ByteSize:            int64(len(raw)),
		Revision:            Revision(raw),
	}, nil
}

func readRawRegular(path string) ([]byte, fs.FileMode, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, 0, normalizeFileError(err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, 0, normalizeFileError(err)
	}
	if !info.Mode().IsRegular() {
		return nil, 0, ErrNotRegular
	}
	if info.Size() > MaxFileSize {
		return nil, 0, ErrTooLarge
	}
	raw, err := io.ReadAll(io.LimitReader(file, MaxFileSize+1))
	if err != nil {
		return nil, 0, normalizeFileError(err)
	}
	if int64(len(raw)) > MaxFileSize {
		return nil, 0, ErrTooLarge
	}
	return raw, info.Mode(), nil
}

func normalizeFileError(err error) error {
	if errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("%w: %w", ErrNotFound, err)
	}
	return err
}

func Revision(raw []byte) string {
	digest := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(digest[:])
}

type pathLockEntry struct {
	mutex sync.Mutex
	refs  int
}

type pathLocks struct {
	mutex   sync.Mutex
	entries map[string]*pathLockEntry
}

func newPathLocks() pathLocks {
	return pathLocks{entries: make(map[string]*pathLockEntry)}
}

func (locks *pathLocks) lock(path string) func() {
	locks.mutex.Lock()
	entry := locks.entries[path]
	if entry == nil {
		entry = &pathLockEntry{}
		locks.entries[path] = entry
	}
	entry.refs++
	locks.mutex.Unlock()

	entry.mutex.Lock()
	return func() {
		entry.mutex.Unlock()
		locks.mutex.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(locks.entries, path)
		}
		locks.mutex.Unlock()
	}
}

func (locks *pathLocks) size() int {
	locks.mutex.Lock()
	defer locks.mutex.Unlock()
	return len(locks.entries)
}
