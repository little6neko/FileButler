package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

type contextKey string

const userContextKey contextKey = "auth_user"

func CurrentUser(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(userContextKey).(User)
	return user, ok
}

func ContextWithUser(ctx context.Context, user User) context.Context {
	return context.WithValue(ctx, userContextKey, user)
}

func InitStatusHandler(service Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		needs, err := service.NeedsInitialization(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "operation_failed", err.Error())
			return
		}
		writeData(w, http.StatusOK, map[string]bool{"needsInitialization": needs})
	}
}

func CreateAdminHandler(service Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
			return
		}
		user, err := service.CreateAdmin(r.Context(), payload.Username, payload.Password)
		if err != nil {
			status := http.StatusBadRequest
			code := "invalid_request"
			if errors.Is(err, ErrAlreadyInitialized) {
				status = http.StatusForbidden
				code = "forbidden"
			}
			writeError(w, status, code, err.Error())
			return
		}
		writeData(w, http.StatusCreated, user)
	}
}

func LoginHandler(service Service, cookieName string, secure bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
			return
		}
		sessionID, user, err := service.Login(r.Context(), payload.Username, payload.Password)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "invalid username or password")
			return
		}
		maxAge := int(service.SessionMaxAge.Seconds())
		if maxAge == 0 {
			maxAge = int((24 * time.Hour).Seconds())
		}
		http.SetCookie(w, &http.Cookie{
			Name:     cookieName,
			Value:    sessionID,
			Path:     "/",
			MaxAge:   maxAge,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   secure,
		})
		writeData(w, http.StatusOK, user)
	}
}

func LogoutHandler(service Service, cookieName string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cookie, err := r.Cookie(cookieName); err == nil {
			_ = service.DeleteSession(r.Context(), cookie.Value)
		}
		http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
		writeData(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func MeHandler(service Service, cookieName string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(cookieName)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		user, err := service.LookupSession(r.Context(), cookie.Value)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		writeData(w, http.StatusOK, user)
	}
}

func RequireAuth(service Service, cookieName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(cookieName)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
				return
			}
			user, err := service.LookupSession(r.Context(), cookie.Value)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey, user)))
		})
	}
}

func writeData(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": value})
}

func writeError(w http.ResponseWriter, status int, code string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}
