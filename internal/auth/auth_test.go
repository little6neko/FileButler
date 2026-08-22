package auth

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestInitStatusAndCreateAdminFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "auth.json")
	service, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	needs, err := service.NeedsInitialization(context.Background())
	if err != nil || !needs {
		t.Fatalf("needs=%v err=%v", needs, err)
	}

	user, err := service.CreateAdmin(context.Background(), " admin ", "long-password")
	if err != nil {
		t.Fatal(err)
	}
	if user.ID != 1 || user.Username != "admin" {
		t.Fatalf("user=%+v", user)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("mode=%#o, want 0600", got)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "long-password") {
		t.Fatal("authentication file contains the plaintext password")
	}
	var stored authenticationFile
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Version != AuthenticationFileVersion || stored.Username != "admin" || !ValidPasswordHash(stored.PasswordHash) {
		t.Fatalf("stored=%+v", stored)
	}
	if matches, err := filepath.Glob(filepath.Join(filepath.Dir(path), ".filebutler-auth-*")); err != nil || len(matches) != 0 {
		t.Fatalf("temporary files=%v err=%v", matches, err)
	}
}

func TestCreateAdminOnlyOnceUnderConcurrency(t *testing.T) {
	service := openMissingService(t)
	start := make(chan struct{})
	errorsByCall := make(chan error, 2)
	var wait sync.WaitGroup
	for _, username := range []string{"first", "second"} {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, err := service.CreateAdmin(context.Background(), username, "long-password")
			errorsByCall <- err
		}()
	}
	close(start)
	wait.Wait()
	close(errorsByCall)
	successes := 0
	alreadyInitialized := 0
	for err := range errorsByCall {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrAlreadyInitialized):
			alreadyInitialized++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if successes != 1 || alreadyInitialized != 1 {
		t.Fatalf("successes=%d alreadyInitialized=%d", successes, alreadyInitialized)
	}
}

func TestLoginUsesStatelessSignedSession(t *testing.T) {
	service := initializedService(t)
	fixedNow := time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return fixedNow }

	token, user, err := service.Login(context.Background(), "admin", "long-password")
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || user.Username != "admin" {
		t.Fatalf("token=%q user=%+v", token, user)
	}
	if got, err := service.LookupSession(context.Background(), token); err != nil || got != user {
		t.Fatalf("lookup=%+v err=%v", got, err)
	}

	parts := strings.Split(token, ".")
	parts[1] = strings.Repeat("A", len(parts[1]))
	if _, err := service.LookupSession(context.Background(), strings.Join(parts, ".")); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("tampered token error=%v", err)
	}
	service.now = func() time.Time { return fixedNow.Add(SessionLifetime) }
	if _, err := service.LookupSession(context.Background(), token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expired token error=%v", err)
	}
}

func TestMultipleLoginsDoNotGrowAuthenticationFile(t *testing.T) {
	service := initializedService(t)
	before, err := os.Stat(service.authFile)
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 20; index++ {
		if _, _, err := service.Login(context.Background(), "admin", "long-password"); err != nil {
			t.Fatal(err)
		}
	}
	after, err := os.Stat(service.authFile)
	if err != nil {
		t.Fatal(err)
	}
	if after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
		t.Fatalf("authentication file changed: before=%+v after=%+v", before, after)
	}
}

func TestOpenRejectsMalformedAuthenticationFiles(t *testing.T) {
	for name, body := range map[string]string{
		"invalid-json":   `{`,
		"unknown-field":  `{"version":1,"username":"admin","passwordHash":"bad","signingKey":"bad","extra":true}`,
		"invalid-fields": `{"version":1,"username":"admin","passwordHash":"bad","signingKey":"bad"}`,
		"trailing-value": `{"version":1} {"version":1}`,
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "auth.json")
			if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := Open(path); err == nil {
				t.Fatal("malformed authentication file was accepted")
			}
		})
	}
}

func TestReplacingSigningKeyInvalidatesExistingSessions(t *testing.T) {
	service := initializedService(t)
	token, _, err := service.Login(context.Background(), "admin", "long-password")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(service.authFile)
	if err != nil {
		t.Fatal(err)
	}
	var stored authenticationFile
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	stored.SigningKey = strings.Repeat("A", 43)
	replacement, err := json.Marshal(stored)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(service.authFile, replacement, 0o600); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(service.authFile)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.LookupSession(context.Background(), token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("old token error=%v", err)
	}
}

func openMissingService(t *testing.T) *Service {
	t.Helper()
	service, err := Open(filepath.Join(t.TempDir(), "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func initializedService(t *testing.T) *Service {
	t.Helper()
	service := openMissingService(t)
	if _, err := service.CreateAdmin(context.Background(), "admin", "long-password"); err != nil {
		t.Fatal(err)
	}
	return service
}
