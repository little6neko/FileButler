package web

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/little6neko/filebutler/internal/textfile"
)

func TestTextEndpointsRequireAuthenticationBeforeInspectingPath(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	router := testRouterWithRoot(t, root)
	tests := []struct {
		method string
		path   string
		body   any
	}{
		{method: http.MethodGet, path: "/api/text?rootId=data&path=notes.txt"},
		{method: http.MethodGet, path: "/api/text?rootId=data&path=missing.txt"},
		{method: http.MethodGet, path: "/api/text?rootId=data&path=../outside.txt"},
		{method: http.MethodPut, path: "/api/text", body: map[string]any{"path": "notes.txt"}},
	}
	for _, test := range tests {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			recorder := textRequest(t, router, test.method, test.path, test.body, nil)
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestTextEndpointReadsSavesDetectsConflictAndForcesOverwrite(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "notes.txt")
	if err := os.WriteFile(path, []byte("old\r\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	router := testRouterWithRoot(t, root)
	cookies := loginCookies(t, router)

	readRecorder := textRequest(t, router, http.MethodGet, "/api/text?rootId=data&path=notes.txt", nil, cookies)
	if readRecorder.Code != http.StatusOK {
		t.Fatalf("read status=%d body=%s", readRecorder.Code, readRecorder.Body.String())
	}
	var readBody struct {
		Data textfile.Document `json:"data"`
	}
	decodeBody(t, readRecorder, &readBody)
	if readBody.Data.Content != "old\r\n" || readBody.Data.LineEnding != textfile.LineEndingCRLF {
		t.Fatalf("document=%+v", readBody.Data)
	}

	savePayload := map[string]any{
		"rootId": "data", "path": "notes.txt", "content": "new\n",
		"encoding": "utf-8", "lineEnding": "crlf", "revision": readBody.Data.Revision, "force": false,
	}
	saveRecorder := textRequest(t, router, http.MethodPut, "/api/text", savePayload, cookies)
	if saveRecorder.Code != http.StatusOK {
		t.Fatalf("save status=%d body=%s", saveRecorder.Code, saveRecorder.Body.String())
	}
	var saveBody struct {
		Data textfile.SaveResult `json:"data"`
	}
	decodeBody(t, saveRecorder, &saveBody)
	if got, err := os.ReadFile(path); err != nil || string(got) != "new\r\n" {
		t.Fatalf("saved=%q err=%v", got, err)
	}
	if saveBody.Data.Revision != textfile.Revision([]byte("new\r\n")) {
		t.Fatalf("save result=%+v", saveBody.Data)
	}

	savePayload["content"] = "stale"
	conflict := textRequest(t, router, http.MethodPut, "/api/text", savePayload, cookies)
	assertTextError(t, conflict, http.StatusConflict, "revision_conflict")
	savePayload["force"] = true
	forced := textRequest(t, router, http.MethodPut, "/api/text", savePayload, cookies)
	if forced.Code != http.StatusOK {
		t.Fatalf("force status=%d body=%s", forced.Code, forced.Body.String())
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "stale" {
		t.Fatalf("forced=%q err=%v", got, err)
	}
}

func TestTextEndpointMapsDomainErrors(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "binary.txt"), []byte("a\x00b"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "folder.txt"), 0o755); err != nil {
		t.Fatal(err)
	}
	large, err := os.Create(filepath.Join(root, "large.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if err := large.Truncate(textfile.MaxFileSize + 1); err != nil {
		t.Fatal(err)
	}
	if err := large.Close(); err != nil {
		t.Fatal(err)
	}
	router := testRouterWithRoot(t, root)
	cookies := loginCookies(t, router)
	tests := []struct {
		path   string
		status int
		code   string
	}{
		{path: "photo.jpg", status: http.StatusUnsupportedMediaType, code: "unsupported_text"},
		{path: "binary.txt", status: http.StatusUnsupportedMediaType, code: "unsupported_text"},
		{path: "missing.txt", status: http.StatusNotFound, code: "not_found"},
		{path: "folder.txt", status: http.StatusBadRequest, code: "invalid_request"},
		{path: "large.txt", status: http.StatusRequestEntityTooLarge, code: "file_too_large"},
		{path: "../escape.txt", status: http.StatusBadRequest, code: "invalid_request"},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			target := "/api/text?rootId=data&path=" + url.QueryEscape(test.path)
			recorder := textRequest(t, router, http.MethodGet, target, nil, cookies)
			assertTextError(t, recorder, test.status, test.code)
		})
	}
}

func TestTextEndpointRejectsOutsideSymlink(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "secret.txt")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	router := testRouterWithRoot(t, root)
	cookies := loginCookies(t, router)
	recorder := textRequest(t, router, http.MethodGet, "/api/text?rootId=data&path=secret.txt", nil, cookies)
	assertTextError(t, recorder, http.StatusBadRequest, "invalid_request")
}

func TestTextSaveEndpointValidatesBodyAndLimitsRequestSize(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	router := testRouterWithRoot(t, root)
	cookies := loginCookies(t, router)
	base := map[string]any{
		"rootId": "data", "path": "notes.txt", "content": "new", "encoding": "utf-8",
		"lineEnding": "lf", "revision": textfile.Revision([]byte("old")), "force": false,
	}
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "empty root", mutate: func(body map[string]any) { body["rootId"] = "" }},
		{name: "empty path", mutate: func(body map[string]any) { body["path"] = "" }},
		{name: "encoding", mutate: func(body map[string]any) { body["encoding"] = "shift-jis" }},
		{name: "line ending", mutate: func(body map[string]any) { body["lineEnding"] = "mixed" }},
		{name: "revision", mutate: func(body map[string]any) { body["revision"] = "bad" }},
		{name: "unknown field", mutate: func(body map[string]any) { body["unexpected"] = true }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body := make(map[string]any, len(base)+1)
			for key, value := range base {
				body[key] = value
			}
			test.mutate(body)
			recorder := textRequest(t, router, http.MethodPut, "/api/text", body, cookies)
			assertTextError(t, recorder, http.StatusBadRequest, "invalid_request")
		})
	}

	oversized := httptest.NewRequest(http.MethodPut, "/api/text", strings.NewReader(strings.Repeat(" ", int(textRequestBodyLimit+1))))
	for _, cookie := range cookies {
		oversized.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, oversized)
	assertTextError(t, recorder, http.StatusRequestEntityTooLarge, "file_too_large")
}

func textRequest(t *testing.T, router http.Handler, method, path string, payload any, cookies []*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var body *bytes.Reader
	if payload == nil {
		body = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(encoded)
	}
	request := httptest.NewRequest(method, path, body)
	request.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func assertTextError(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != code {
		t.Fatalf("code=%q body=%+v", body.Error.Code, body)
	}
}
