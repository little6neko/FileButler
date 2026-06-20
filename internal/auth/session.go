package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"time"
)

func newSessionID() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func (s Service) LookupSession(ctx context.Context, sessionID string) (User, error) {
	if sessionID == "" {
		return User{}, ErrUnauthorized
	}
	var user User
	var expiresRaw string
	err := s.DB.QueryRowContext(ctx, `
select users.id, users.username, sessions.expires_at
from sessions join users on users.id = sessions.user_id
where sessions.id = ?`, sessionID).Scan(&user.ID, &user.Username, &expiresRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	if err != nil {
		return User{}, err
	}
	expires, err := time.Parse(time.RFC3339Nano, expiresRaw)
	if err != nil {
		return User{}, err
	}
	if !time.Now().Before(expires) {
		_ = s.DeleteSession(ctx, sessionID)
		return User{}, ErrUnauthorized
	}
	return user, nil
}

func (s Service) DeleteSession(ctx context.Context, sessionID string) error {
	_, err := s.DB.ExecContext(ctx, `delete from sessions where id = ?`, sessionID)
	return err
}
