package cloud115

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
)

type Service struct {
	accountMu sync.Mutex
	Provider  Provider
	Store     jobs.Store
	Roots     roots.Resolver
	queue     chan struct{}
	previews  map[string]batchPreview
}

func NewService(provider Provider, store jobs.Store, resolver roots.Resolver) *Service {
	return &Service{Provider: provider, Store: store, Roots: resolver, queue: make(chan struct{}, 1), previews: make(map[string]batchPreview)}
}

type Request struct {
	ID       string   `json:"id"`
	IDs      []string `json:"ids"`
	ParentID string   `json:"parentId"`
	DestID   string   `json:"destId"`
	Name     string   `json:"name"`
	Password string   `json:"password"`
	Offset   int      `json:"offset"`
	RootID   string   `json:"rootId"`
	Path     string   `json:"path"`
	Paths    []string `json:"paths"`
	URL      string   `json:"url"`
}

var numericID = regexp.MustCompile(`^(0|[1-9][0-9]{0,19})$`)
var queries = map[string]bool{"status": true, "login.start": true, "login.check": true, "logout": true, "browse": true, "profile": true, "resolve": true, "offline.add": true}
var mutations = map[string]bool{"mkdir": true, "rename": true, "copy": true, "move": true, "delete": true, "upload": true, "download": true, "extract": true}

func (s *Service) Handler(w http.ResponseWriter, r *http.Request) {
	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	method := chi.URLParam(r, "method")
	if strings.HasPrefix(method, "power.") || strings.HasPrefix(method, "super.") {
		s.batchHandler(w, r, method)
		return
	}
	if !queries[method] && !mutations[method] {
		respond(w, 404, nil, "unknown 115 operation")
		return
	}
	var req Request
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		respond(w, 400, nil, "invalid request")
		return
	}
	if req.ParentID == "" {
		req.ParentID = "0"
	}
	if req.DestID == "" {
		req.DestID = "0"
	}
	if !numericID.MatchString(req.ParentID) || !numericID.MatchString(req.DestID) || req.Offset < 0 || len(req.IDs) > 1000 || len(req.Paths) > 1000 {
		respond(w, 400, nil, "invalid directory or selection")
		return
	}
	for _, id := range append(append([]string{}, req.IDs...), req.ID) {
		if id != "" && (!numericID.MatchString(id) || id == "0") {
			respond(w, 400, nil, "invalid file ID")
			return
		}
	}
	params := map[string]any{"id": req.ID, "parentId": req.ParentID, "destId": req.DestID, "name": req.Name, "password": req.Password, "offset": req.Offset, "path": req.Path}
	if method == "offline.add" {
		link := strings.TrimSpace(req.URL)
		parsed, err := url.Parse(link)
		valid := len(link) <= 16384 && !strings.ContainsAny(link, "\r\n\t\x00 ")
		if strings.HasPrefix(link, "ed2k://") {
			// ed2k uses pipe-delimited fields, not a standard URL authority.
			valid = valid && strings.HasPrefix(link, "ed2k://|file|") && strings.HasSuffix(link, "|/")
		} else if valid && err == nil {
			switch parsed.Scheme {
			case "magnet":
				valid = parsed.Query().Get("xt") != ""
			case "http", "https", "ftp":
				valid = parsed.Hostname() != ""
			default:
				valid = false
			}
		} else {
			valid = false
		}
		if !valid {
			respond(w, 400, nil, "请输入有效的磁力、ed2k、HTTP/HTTPS或FTP链接（每行一条）")
			return
		}
		params["url"] = link
	}
	if queries[method] {
		// Never change accounts while queued/running cloud tasks can still reference them.
		if method == "logout" || method == "login.start" || method == "login.check" {
			snapshot, _ := s.Store.Snapshot(r.Context())
			for _, job := range snapshot.Jobs {
				if job.SourceRootID == "@115" || job.DestRootID == "@115" {
					respond(w, 409, nil, "115任务运行中，暂不能切换账号")
					return
				}
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
		defer cancel()
		data, err := s.Provider.Call(ctx, method, params, nil)
		if err != nil {
			respond(w, 502, nil, err.Error())
			return
		}
		respond(w, 200, data, "")
		return
	}
	items := make([]map[string]any, 0)
	sourceRoot, destRoot := "@115", "@115"
	if method == "upload" {
		sourceRoot = req.RootID
		for _, path := range req.Paths {
			resolved, err := s.Roots.ResolveEntry(req.RootID, path)
			if err != nil {
				respond(w, 400, nil, err.Error())
				return
			}
			info, err := os.Lstat(resolved.Actual.Abs)
			if err != nil || info.Mode()&os.ModeSymlink != 0 {
				respond(w, 400, nil, "cannot upload a symbolic link or missing file")
				return
			}
			items = append(items, map[string]any{"localPath": resolved.Actual.Abs, "name": filepath.Base(resolved.Actual.Abs)})
		}
	} else {
		if method == "download" {
			destRoot = req.RootID
			resolved, err := s.Roots.ResolveFollow(req.RootID, req.Path)
			if err != nil {
				respond(w, 400, nil, err.Error())
				return
			}
			info, err := os.Stat(resolved.Actual.Abs)
			if err != nil || !info.IsDir() {
				respond(w, 400, nil, "download destination is not a directory")
				return
			}
			params["localPath"] = resolved.Actual.Abs
		}
		if req.ID != "" {
			req.IDs = []string{req.ID}
		}
		for _, id := range req.IDs {
			items = append(items, map[string]any{"id": id})
		}
		if method == "mkdir" {
			items = []map[string]any{{}}
		}
	}
	if len(items) == 0 {
		respond(w, 400, nil, "select at least one file")
		return
	}
	user, ok := auth.CurrentUser(r.Context())
	if !ok {
		respond(w, 401, nil, "authentication required")
		return
	}
	id := jobs.NewID()
	err := s.Store.Create(r.Context(), jobs.Job{ID: id, Type: method, ActorID: user.ID, SourceRootID: sourceRoot, DestRootID: destRoot, ProgressTotal: len(items)})
	if err != nil {
		respond(w, 500, nil, err.Error())
		return
	}
	go s.run(id, method, params, items)
	respond(w, 201, map[string]string{"id": id}, "")
}

func (s *Service) run(id, method string, params map[string]any, items []map[string]any) {
	ctx := context.Background()
	// Serialize account mutations and extraction; HTTP requests and SSE never own this context.
	s.queue <- struct{}{}
	defer func() { <-s.queue }()
	_ = s.Store.MarkRunning(ctx, id)
	failures := 0
	for _, item := range items {
		cancel, err := s.Store.IsCancelRequested(ctx, id)
		if err != nil {
			return
		}
		if cancel {
			_ = s.Store.Finish(ctx, id, jobs.StatusCanceled, "")
			return
		}
		args := make(map[string]any, len(params)+len(item))
		for k, v := range params {
			args[k] = v
		}
		for k, v := range item {
			args[k] = v
		}
		_, err = s.Provider.Call(ctx, method, args, func(p jobs.TransferProgress) error { return s.Store.ReportTransfer(ctx, id, p) })
		if errors.Is(err, context.Canceled) {
			_ = s.Store.Finish(ctx, id, jobs.StatusCanceled, "")
			return
		}
		if err != nil {
			failures++
		}
		_ = s.Store.RecordProgress(ctx, id, err)
	}
	status := jobs.StatusCompleted
	if failures > 0 {
		status = jobs.StatusCompletedWithErrors
	}
	_ = s.Store.Finish(ctx, id, status, "")
}

func respond(w http.ResponseWriter, status int, data any, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if message != "" {
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "cloud115_error", "message": message}})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
}
