package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"strings"
	"sync"
	"time"
)

const (
	AuthenticationFileVersion = 1
	SessionLifetime           = 24 * time.Hour
	administratorID           = int64(1)
	signingKeyLength          = 32
)

var (
	ErrInvalidCredentials = errors.New("invalid_credentials")
	ErrInvalidRequest     = errors.New("invalid_request")
	ErrAlreadyInitialized = errors.New("already_initialized")
	ErrUnauthorized       = errors.New("unauthorized")
)

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type credentials struct {
	version      int
	username     string
	passwordHash string
	signingKey   []byte
}

type Service struct {
	mu          sync.RWMutex
	authFile    string
	credentials *credentials
	now         func() time.Time
	random      io.Reader
}

func Open(authFile string) (*Service, error) {
	service := &Service{
		authFile: authFile,
		now:      time.Now,
		random:   rand.Reader,
	}
	loaded, err := loadAuthenticationFile(authFile)
	if errors.Is(err, errAuthenticationFileMissing) {
		return service, nil
	}
	if err != nil {
		return nil, err
	}
	service.credentials = loaded
	return service, nil
}

func (s *Service) NeedsInitialization(ctx context.Context) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.credentials == nil, nil
}

func (s *Service) CreateAdmin(ctx context.Context, username, password string) (User, error) {
	username = strings.TrimSpace(username)
	if username == "" || len(password) < 10 {
		return User{}, ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return User{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.credentials != nil {
		return User{}, ErrAlreadyInitialized
	}
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, err
	}
	key := make([]byte, signingKeyLength)
	if _, err := io.ReadFull(s.random, key); err != nil {
		return User{}, err
	}
	record := credentials{
		version:      AuthenticationFileVersion,
		username:     username,
		passwordHash: hash,
		signingKey:   key,
	}
	if err := createAuthenticationFile(s.authFile, record); err != nil {
		if errors.Is(err, ErrAlreadyInitialized) {
			return User{}, ErrAlreadyInitialized
		}
		return User{}, err
	}
	s.credentials = &record
	return User{ID: administratorID, Username: username}, nil
}

func (s *Service) Login(ctx context.Context, username, password string) (string, User, error) {
	if err := ctx.Err(); err != nil {
		return "", User{}, err
	}
	username = strings.TrimSpace(username)
	s.mu.RLock()
	record := cloneCredentials(s.credentials)
	s.mu.RUnlock()
	if record == nil || username != record.username || !VerifyPassword(record.passwordHash, password) {
		return "", User{}, ErrInvalidCredentials
	}
	user := User{ID: administratorID, Username: record.username}
	token, err := createSessionToken(*record, s.currentTime())
	if err != nil {
		return "", User{}, err
	}
	return token, user, nil
}

func (s *Service) LookupSession(ctx context.Context, token string) (User, error) {
	if err := ctx.Err(); err != nil {
		return User{}, err
	}
	s.mu.RLock()
	record := cloneCredentials(s.credentials)
	s.mu.RUnlock()
	if record == nil {
		return User{}, ErrUnauthorized
	}
	claims, err := verifySessionToken(token, *record, s.currentTime())
	if err != nil || claims.Username != record.username {
		return User{}, ErrUnauthorized
	}
	return User{ID: administratorID, Username: record.username}, nil
}

func (s *Service) currentTime() time.Time {
	if s.now == nil {
		return time.Now().UTC()
	}
	return s.now().UTC()
}

func cloneCredentials(value *credentials) *credentials {
	if value == nil {
		return nil
	}
	cloned := *value
	cloned.signingKey = append([]byte(nil), value.signingKey...)
	return &cloned
}
