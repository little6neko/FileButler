package superrename

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const recoveryManifestVersion = 1

type recoveryManifest struct {
	Version       int                    `json:"version"`
	JobID         string                 `json:"jobId"`
	RootID        string                 `json:"rootId"`
	GroupPath     string                 `json:"groupPath"`
	Phase         string                 `json:"phase"`
	CreatedAtUnix int64                  `json:"createdAtUnix"`
	Items         []recoveryManifestItem `json:"items"`
}

type recoveryManifestItem struct {
	SourcePath string `json:"sourcePath"`
	StagePath  string `json:"stagePath"`
	TargetPath string `json:"targetPath"`
}

func writeManifestAtomic(manifestPath string, manifest recoveryManifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	directory := filepath.Dir(manifestPath)
	temporary, err := os.CreateTemp(directory, ".manifest-*")
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
	if err := temporary.Chmod(0o600); err != nil {
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	closed = true
	if err := os.Rename(temporaryPath, manifestPath); err != nil {
		return err
	}
	return syncDirectory(directory)
}

func syncDirectory(directory string) error {
	handle, err := os.Open(directory)
	if err != nil {
		return err
	}
	syncErr := handle.Sync()
	closeErr := handle.Close()
	return errors.Join(syncErr, closeErr)
}

type RecoveryRequiredError struct {
	StagePath string
	Cause     error
	Recovery  error
}

func (e *RecoveryRequiredError) Error() string {
	return fmt.Sprintf("SuperRename recovery is required at %s: operation failed: %v; recovery failed: %v", e.StagePath, e.Cause, e.Recovery)
}

func (e *RecoveryRequiredError) Unwrap() []error {
	return []error{e.Cause, e.Recovery}
}
