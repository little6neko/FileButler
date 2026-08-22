package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

type sessionClaims struct {
	Version   int    `json:"version"`
	Username  string `json:"username"`
	ExpiresAt int64  `json:"expiresAt"`
}

func createSessionToken(record credentials, now time.Time) (string, error) {
	claims := sessionClaims{
		Version:   record.version,
		Username:  record.username,
		ExpiresAt: now.Add(SessionLifetime).Unix(),
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signature := sessionSignature(record.signingKey, encodedPayload)
	return encodedPayload + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func verifySessionToken(token string, record credentials, now time.Time) (sessionClaims, error) {
	encodedPayload, encodedSignature, ok := strings.Cut(token, ".")
	if !ok || encodedPayload == "" || encodedSignature == "" || strings.Contains(encodedSignature, ".") {
		return sessionClaims{}, ErrUnauthorized
	}
	providedSignature, err := base64.RawURLEncoding.DecodeString(encodedSignature)
	if err != nil || len(providedSignature) != sha256.Size {
		return sessionClaims{}, ErrUnauthorized
	}
	expectedSignature := sessionSignature(record.signingKey, encodedPayload)
	if subtle.ConstantTimeCompare(providedSignature, expectedSignature) != 1 {
		return sessionClaims{}, ErrUnauthorized
	}
	payload, err := base64.RawURLEncoding.DecodeString(encodedPayload)
	if err != nil {
		return sessionClaims{}, ErrUnauthorized
	}
	var claims sessionClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return sessionClaims{}, ErrUnauthorized
	}
	if claims.Version != record.version || claims.Username == "" || claims.ExpiresAt <= now.Unix() {
		return sessionClaims{}, ErrUnauthorized
	}
	return claims, nil
}

func sessionSignature(key []byte, payload string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(payload))
	return mac.Sum(nil)
}
