package auth

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
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

type Service struct {
	DB            *sql.DB
	SessionMaxAge time.Duration
}

func (s Service) NeedsInitialization(ctx context.Context) (bool, error) {
	var count int
	if err := s.DB.QueryRowContext(ctx, `select count(1) from users`).Scan(&count); err != nil {
		return false, err
	}
	return count == 0, nil
}

func (s Service) CreateAdmin(ctx context.Context, username, password string) (User, error) {
	username = strings.TrimSpace(username)
	if username == "" || len(password) < 10 {
		return User{}, ErrInvalidRequest
	}
	needs, err := s.NeedsInitialization(ctx)
	if err != nil {
		return User{}, err
	}
	if !needs {
		return User{}, ErrAlreadyInitialized
	}
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, err
	}
	res, err := s.DB.ExecContext(ctx, `insert into users(username, password_hash) values (?, ?)`, username, hash)
	if err != nil {
		return User{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return User{}, err
	}
	return User{ID: id, Username: username}, nil
}

func (s Service) Login(ctx context.Context, username, password string) (string, User, error) {
	username = strings.TrimSpace(username)
	var user User
	var hash string
	err := s.DB.QueryRowContext(ctx, `select id, username, password_hash from users where username = ?`, username).Scan(&user.ID, &user.Username, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", User{}, ErrInvalidCredentials
	}
	if err != nil {
		return "", User{}, err
	}
	if !VerifyPassword(hash, password) {
		return "", User{}, ErrInvalidCredentials
	}
	sessionID, err := newSessionID()
	if err != nil {
		return "", User{}, err
	}
	maxAge := s.SessionMaxAge
	if maxAge == 0 {
		maxAge = 24 * time.Hour
	}
	expires := time.Now().Add(maxAge).UTC()
	if _, err := s.DB.ExecContext(ctx, `insert into sessions(id, user_id, expires_at) values (?, ?, ?)`, sessionID, user.ID, expires.Format(time.RFC3339Nano)); err != nil {
		return "", User{}, err
	}
	return sessionID, user, nil
}
