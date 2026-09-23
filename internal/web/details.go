package web

import (
	"context"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/details"
	"net/http"
	"time"
)

func detailsHandler(service details.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		var req details.Request
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&req) != nil {
			Error(w, 400, "invalid_request", "无效的文件选择")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
		defer cancel()
		var result any
		var err error
		switch chi.URLParam(r, "section") {
		case "basic":
			result, err = service.Basic(ctx, req)
		case "stats":
			result, err = service.Stats(ctx, req)
		case "hash":
			result, err = service.Hash(ctx, req)
		case "media":
			f, e := service.Open(req)
			if e != nil {
				err = e
				break
			}
			defer f.Close()
			info, e := f.Stat()
			if e != nil {
				err = e
				break
			}
			result = details.Probe(ctx, f, info.Size(), info.Name())
		default:
			Error(w, 404, "not_found", "未知的信息类型")
			return
		}
		if err != nil {
			Error(w, 400, "details_failed", err.Error())
			return
		}
		Data(w, 200, result)
	}
}
