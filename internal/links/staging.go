package links

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	stagingVersion = 1
	stagingPrefix  = ".filebutler-link-"
	markerName     = ".filebutler-link.json"
	payloadName    = "payload"
)

var (
	tokenPattern    = regexp.MustCompile(`^[0-9a-f]{32}$`)
	revisionPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
)

type StagingMarker struct {
	Version         int    `json:"version"`
	RuntimeID       string `json:"runtimeId"`
	JobID           string `json:"jobId"`
	Token           string `json:"token"`
	DestName        string `json:"destName"`
	PreviewRevision string `json:"previewRevision"`
}

type StagingArea struct {
	Container  string
	Payload    string
	MarkerPath string
	Marker     StagingMarker
}

func (area StagingArea) Identifier() string {
	return filepath.Base(area.Container)
}

type stagingFileSystem interface {
	MkdirTemp(string, string) (string, error)
	Chmod(string, os.FileMode) error
	Lstat(string) (os.FileInfo, error)
	ReadFile(string) ([]byte, error)
	ReadDir(string) ([]os.DirEntry, error)
	RemoveAll(string) error
}

type osStagingFileSystem struct{}

func (osStagingFileSystem) MkdirTemp(directory string, pattern string) (string, error) {
	return os.MkdirTemp(directory, pattern)
}

func (osStagingFileSystem) Chmod(path string, mode os.FileMode) error {
	return os.Chmod(path, mode)
}

func (osStagingFileSystem) Lstat(path string) (os.FileInfo, error) {
	return os.Lstat(path)
}

func (osStagingFileSystem) ReadFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func (osStagingFileSystem) ReadDir(path string) ([]os.DirEntry, error) {
	return os.ReadDir(path)
}

func (osStagingFileSystem) RemoveAll(path string) error {
	return os.RemoveAll(path)
}

type StagingManager struct {
	RuntimeID   string
	fileSystem  stagingFileSystem
	writeAtomic func(string, []byte, os.FileMode) error
	newToken    func() (string, error)
}

func NewStagingManager(runtimeID string) StagingManager {
	return StagingManager{RuntimeID: runtimeID}
}

func (manager StagingManager) Create(parent string, jobID string, destName string, revision string) (StagingArea, error) {
	if manager.RuntimeID == "" || jobID == "" || !validDestName(destName) || !revisionPattern.MatchString(revision) {
		return StagingArea{}, ErrInvalidStaging
	}
	token, err := manager.tokenGenerator()()
	if err != nil {
		return StagingArea{}, err
	}
	if !tokenPattern.MatchString(token) {
		return StagingArea{}, ErrInvalidStaging
	}
	fileSystem := manager.fs()
	container, err := fileSystem.MkdirTemp(parent, stagingPrefix+token+"-*")
	if err != nil {
		return StagingArea{}, err
	}
	cleanupOnError := func(operationErr error) (StagingArea, error) {
		return StagingArea{}, errors.Join(operationErr, fileSystem.RemoveAll(container))
	}
	if err := fileSystem.Chmod(container, 0o700); err != nil {
		return cleanupOnError(err)
	}
	marker := StagingMarker{
		Version:         stagingVersion,
		RuntimeID:       manager.RuntimeID,
		JobID:           jobID,
		Token:           token,
		DestName:        destName,
		PreviewRevision: revision,
	}
	encoded, err := json.Marshal(marker)
	if err != nil {
		return cleanupOnError(err)
	}
	markerPath := filepath.Join(container, markerName)
	if err := manager.atomicWriter()(markerPath, encoded, 0o600); err != nil {
		return cleanupOnError(err)
	}
	return StagingArea{
		Container:  container,
		Payload:    filepath.Join(container, payloadName),
		MarkerPath: markerPath,
		Marker:     marker,
	}, nil
}

func (manager StagingManager) Validate(container string) (StagingMarker, bool, error) {
	if !strings.HasPrefix(filepath.Base(container), stagingPrefix) {
		return StagingMarker{}, false, nil
	}
	fileSystem := manager.fs()
	info, err := fileSystem.Lstat(container)
	if errors.Is(err, os.ErrNotExist) {
		return StagingMarker{}, false, nil
	}
	if err != nil {
		return StagingMarker{}, false, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() || info.Mode().Perm() != 0o700 {
		return StagingMarker{}, false, nil
	}
	markerPath := filepath.Join(container, markerName)
	markerInfo, err := fileSystem.Lstat(markerPath)
	if errors.Is(err, os.ErrNotExist) {
		return StagingMarker{}, false, nil
	}
	if err != nil {
		return StagingMarker{}, false, err
	}
	if !markerInfo.Mode().IsRegular() {
		return StagingMarker{}, false, nil
	}
	encoded, err := fileSystem.ReadFile(markerPath)
	if err != nil {
		return StagingMarker{}, false, err
	}
	marker, ok := decodeMarker(encoded)
	if !ok || !validMarker(marker, filepath.Base(container)) {
		return StagingMarker{}, false, nil
	}
	entries, err := fileSystem.ReadDir(container)
	if err != nil {
		return StagingMarker{}, false, err
	}
	payloads := 0
	markers := 0
	for _, entry := range entries {
		switch entry.Name() {
		case markerName:
			markers++
		case payloadName:
			payloads++
		default:
			return StagingMarker{}, false, nil
		}
	}
	if markers != 1 || payloads > 1 {
		return StagingMarker{}, false, nil
	}
	return marker, true, nil
}

func (manager StagingManager) Cleanup(area StagingArea) error {
	marker, valid, err := manager.Validate(area.Container)
	if err != nil {
		return err
	}
	if !valid || marker != area.Marker {
		return ErrInvalidStaging
	}
	fileSystem := manager.fs()
	if err := makeRemovable(fileSystem, area.Payload); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return fileSystem.RemoveAll(area.Container)
}

func makeRemovable(fileSystem stagingFileSystem, currentPath string) error {
	info, err := fileSystem.Lstat(currentPath)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return nil
	}
	if err := fileSystem.Chmod(currentPath, 0o700); err != nil {
		return err
	}
	entries, err := fileSystem.ReadDir(currentPath)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := makeRemovable(fileSystem, filepath.Join(currentPath, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func (manager StagingManager) fs() stagingFileSystem {
	if manager.fileSystem != nil {
		return manager.fileSystem
	}
	return osStagingFileSystem{}
}

func (manager StagingManager) atomicWriter() func(string, []byte, os.FileMode) error {
	if manager.writeAtomic != nil {
		return manager.writeAtomic
	}
	return atomicWriteMarker
}

func (manager StagingManager) tokenGenerator() func() (string, error) {
	if manager.newToken != nil {
		return manager.newToken
	}
	return randomToken
}

func randomToken() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func atomicWriteMarker(path string, content []byte, mode os.FileMode) error {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".marker-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
		_ = os.Remove(temporaryPath)
	}()
	if err := temporary.Chmod(mode); err != nil {
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	closed = true
	return os.Rename(temporaryPath, path)
}

func decodeMarker(encoded []byte) (StagingMarker, bool) {
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	var marker StagingMarker
	if err := decoder.Decode(&marker); err != nil {
		return StagingMarker{}, false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return StagingMarker{}, false
	}
	return marker, true
}

func validMarker(marker StagingMarker, containerName string) bool {
	return marker.Version == stagingVersion && marker.RuntimeID != "" && marker.JobID != "" &&
		tokenPattern.MatchString(marker.Token) && validDestName(marker.DestName) &&
		revisionPattern.MatchString(marker.PreviewRevision) &&
		strings.HasPrefix(containerName, stagingPrefix+marker.Token+"-")
}

func validDestName(name string) bool {
	return name != "" && name != "." && name != ".." && !filepath.IsAbs(name) && filepath.Base(name) == name
}

type StagingCleanupError struct {
	Identifier string
	Cause      error
	Cleanup    error
}

func (err *StagingCleanupError) Error() string {
	return fmt.Sprintf("link staging cleanup required for %s", err.Identifier)
}

func (err *StagingCleanupError) Unwrap() error {
	return err.Cause
}
