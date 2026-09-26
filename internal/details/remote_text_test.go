package details

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBoundedRemoteRead(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		limit      int64
		wantError  bool
	}{
		{"ordinary response without CORS", "hello", 200, 10, false},
		{"exact limit", "hello", 200, 5, false},
		{"empty", "", 200, 5, false},
		{"over limit", "too long", 200, 5, true},
		{"upstream error", "private response", 403, 100, true},
		{"partial response", "hello", 206, 100, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.UserAgent() != "TestUA" || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
					t.Error("wrong request headers")
				}
				w.WriteHeader(tc.status)
				w.(http.Flusher).Flush()
				io.WriteString(w, tc.body)
			}))
			defer server.Close()
			data, err := readRemote(context.Background(), server.Client(), server.URL+"?secret=hidden", "TestUA", tc.limit)
			if (err != nil) != tc.wantError {
				t.Fatalf("err=%v", err)
			}
			if err == nil && string(data) != tc.body {
				t.Fatalf("data=%q", data)
			}
			if err != nil && (strings.Contains(err.Error(), "hidden") || strings.Contains(err.Error(), "private response")) {
				t.Fatal("secret leaked")
			}
		})
	}
}

func TestRemoteReadCancellationAndPrivateAddresses(t *testing.T) {
	started := make(chan struct{})
	ended := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(ended)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := readRemote(ctx, server.Client(), server.URL, "TestUA", 10); done <- err }()
	<-started
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("read did not cancel")
	}
	<-ended
	for _, url := range []string{server.URL, "file:///etc/passwd", "https://user:pass@example.com", "http://169.254.169.254/latest/meta-data"} {
		if _, err := ReadRemote(context.Background(), url, "TestUA", 10); err == nil {
			t.Fatal("accepted unsafe URL", url)
		}
	}
}

func TestRemoteReadRejectsPrivateRedirect(t *testing.T) {
	// Use a controlled first hop; subsequent hops use the production safe transport.
	client := newRemoteClient()
	original := client.Transport
	client.Transport = redirectTransport{next: original}
	_, err := readRemote(context.Background(), client, "https://public.example/start", "TestUA", 10)
	if err == nil {
		t.Fatal("accepted private redirect")
	}
}

type redirectTransport struct{ next http.RoundTripper }

func (r redirectTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Host == "public.example" {
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"http://127.0.0.1:9/secret"}}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
	}
	return r.next.RoundTrip(req)
}
