package cloud115

import (
	"context"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/details"
	"net/http"
	"time"
)

func (s *Service) detailsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	method := chi.URLParam(r, "method")
	if method != "details.basic" && method != "details.stats" && method != "details.hash" && method != "details.media" {
		respond(w, 404, nil, "unknown details operation")
		return
	}
	var req struct {
		IDs       []string `json:"ids"`
		AccountID string   `json:"accountId"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&req) != nil || len(req.IDs) == 0 || len(req.IDs) > 1000 || !numericID.MatchString(req.AccountID) || req.AccountID == "0" {
		respond(w, 400, nil, "无效的文件选择")
		return
	}
	for _, id := range req.IDs {
		if !numericID.MatchString(id) {
			respond(w, 400, nil, "无效的文件ID")
			return
		}
	}
	if (method == "details.hash" || method == "details.media") && len(req.IDs) != 1 {
		respond(w, 400, nil, "请选择一个文件")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	release, e := details.Acquire(ctx)
	if e != nil {
		return
	}
	defer release()
	if method == "details.media" {
		ctx, stop := context.WithTimeout(ctx, 10*time.Second)
		defer stop()
		// Bind URL generation to the expected account inside the worker lock.
		data, e := s.Provider.Call(ctx, "details.url", map[string]any{"ids": req.IDs, "accountId": req.AccountID, "userAgent": r.UserAgent()}, nil)
		if e != nil {
			respond(w, 502, nil, e.Error())
			return
		}
		var link struct {
			URL       string `json:"url"`
			Name      string `json:"name"`
			Size      int64  `json:"size"`
			AccountID string `json:"accountId"`
		}
		if json.Unmarshal(data, &link) != nil || link.AccountID != req.AccountID {
			respond(w, 409, nil, "115账号已变化")
			return
		}
		reader := details.NewRemoteReader(ctx, link.URL, r.UserAgent(), link.Size)
		respond(w, 200, details.Probe(ctx, reader, link.Size, link.Name), "")
		return
	}
	data, e := s.Provider.Call(ctx, method, req, nil)
	if e != nil {
		respond(w, 502, nil, e.Error())
		return
	}
	respond(w, 200, data, "")
}
