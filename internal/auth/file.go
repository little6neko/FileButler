package auth

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

var errAuthenticationFileMissing = errors.New("authentication file is missing")

type authenticationFile struct {
	Version      int    `json:"version"`
	Username     string `json:"username"`
	PasswordHash string `json:"passwordHash"`
	SigningKey   string `json:"signingKey"`
}

func loadAuthenticationFile(path string) (*credentials, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("authentication file path is empty")
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, errAuthenticationFileMissing
	}
	if err != nil {
		return nil, fmt.Errorf("read authentication file: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var stored authenticationFile
	if err := decoder.Decode(&stored); err != nil {
		return nil, fmt.Errorf("decode authentication file: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return nil, fmt.Errorf("decode authentication file: %w", err)
	}
	return validateAuthenticationFile(stored)
}

func validateAuthenticationFile(stored authenticationFile) (*credentials, error) {
	if stored.Version != AuthenticationFileVersion {
		return nil, fmt.Errorf("unsupported authentication file version %d", stored.Version)
	}
	if stored.Username == "" || stored.Username != strings.TrimSpace(stored.Username) {
		return nil, errors.New("authentication file has an invalid username")
	}
	if !ValidPasswordHash(stored.PasswordHash) {
		return nil, errors.New("authentication file has an invalid password hash")
	}
	key, err := base64.RawURLEncoding.DecodeString(stored.SigningKey)
	if err != nil || len(key) != signingKeyLength {
		return nil, errors.New("authentication file has an invalid signing key")
	}
	return &credentials{
		version:      stored.Version,
		username:     stored.Username,
		passwordHash: stored.PasswordHash,
		signingKey:   key,
	}, nil
}

func createAuthenticationFile(path string, record credentials) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("authentication file path is empty")
	}
	stored := authenticationFile{
		Version:      record.version,
		Username:     record.username,
		PasswordHash: record.passwordHash,
		SigningKey:   base64.RawURLEncoding.EncodeToString(record.signingKey),
	}
	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create authentication directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".filebutler-auth-*")
	if err != nil {
		return fmt.Errorf("create temporary authentication file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return fmt.Errorf("set authentication file permissions: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		return fmt.Errorf("write authentication file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("flush authentication file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close authentication file: %w", err)
	}
	closed = true
	if err := os.Link(temporaryPath, path); err != nil {
		if errors.Is(err, os.ErrExist) {
			return ErrAlreadyInitialized
		}
		return fmt.Errorf("publish authentication file: %w", err)
	}
	return nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var trailing any
	err := decoder.Decode(&trailing)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("authentication file contains multiple JSON values")
	}
	return err
}
