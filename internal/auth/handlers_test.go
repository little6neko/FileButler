package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLoginHandlerSetsFixedStatelessCookie(t *testing.T) {
	service := initializedService(t)
	body, err := json.Marshal(map[string]string{"username": "admin", "password": "long-password"})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	LoginHandler(service, "session", true).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies=%v", cookies)
	}
	cookie := cookies[0]
	if cookie.Name != "session" || cookie.Value == "" || cookie.MaxAge != int(SessionLifetime.Seconds()) || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie=%+v", cookie)
	}
	if _, err := service.LookupSession(context.Background(), cookie.Value); err != nil {
		t.Fatalf("cookie token was rejected: %v", err)
	}
}

func TestLogoutHandlerOnlyDeletesTheCurrentBrowserCookie(t *testing.T) {
	service := initializedService(t)
	token, _, err := service.Login(context.Background(), "admin", "long-password")
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	LogoutHandler("session", true).ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "session" || cookies[0].MaxAge >= 0 || !cookies[0].Secure {
		t.Fatalf("cookies=%v", cookies)
	}
	if _, err := service.LookupSession(context.Background(), token); err != nil {
		t.Fatalf("logout revoked a stateless token: %v", err)
	}
}
