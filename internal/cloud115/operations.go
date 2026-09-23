package cloud115

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
)

type operationRequest struct {
	Type            string   `json:"type"`
	SourceRoot      string   `json:"sourceRoot"`
	Sources         []string `json:"sources"`
	DestRoot        string   `json:"destRoot"`
	DestPath        string   `json:"destPath"`
	AccountID       string   `json:"accountId"`
	SourceAccountID string   `json:"sourceAccountId"`
	DestAccountID   string   `json:"destAccountId"`
	PreviewToken    string   `json:"previewToken"`
}
type operationPlan struct {
	Items       []json.RawMessage `json:"items"`
	HasConflict bool              `json:"hasConflict"`
	Revision    string            `json:"revision"`
	Entries     []map[string]any  `json:"entries"`
}
type operationPreview struct {
	Actor   int64
	Expires time.Time
	Request operationRequest
	Params  map[string]any
	Plan    operationPlan
}

func (s *Service) operationParams(req operationRequest) (map[string]any, error) {
	if (req.Type != "copy" && req.Type != "move" && req.Type != "delete") || len(req.Sources) == 0 || len(req.Sources) > 1000 || req.AccountID == "" {
		return nil, fmt.Errorf("无效操作或账号")
	}
	sourceCloud, targetCloud := req.SourceRoot == "@115", req.DestRoot == "@115"
	if sourceCloud && req.SourceAccountID != req.AccountID || targetCloud && req.Type != "delete" && req.DestAccountID != req.AccountID {
		return nil, fmt.Errorf("暂不支持跨115账号操作或账号参数缺失")
	}
	if !sourceCloud && !targetCloud {
		return nil, fmt.Errorf("请选择115相关操作")
	}
	if req.Type == "delete" && !sourceCloud {
		return nil, fmt.Errorf("无效删除来源")
	}
	params := map[string]any{"type": req.Type, "sourceCloud": sourceCloud, "targetCloud": targetCloud, "accountId": req.AccountID}
	entries := []map[string]any{}
	seen := map[string]bool{}
	for _, source := range req.Sources {
		if seen[source] {
			return nil, fmt.Errorf("重复来源")
		}
		seen[source] = true
		if sourceCloud {
			if !numericID.MatchString(source) || source == "0" {
				return nil, fmt.Errorf("无效115文件ID")
			}
			entries = append(entries, map[string]any{"id": source})
		} else {
			if source == "" || filepath.Clean(source) == "." {
				return nil, fmt.Errorf("不能传输根目录")
			}
			resolved, err := s.Roots.ResolveEntry(req.SourceRoot, source)
			if err != nil {
				return nil, err
			}
			entries = append(entries, map[string]any{"localPath": resolved.Actual.Abs})
		}
	}
	params["sources"] = entries
	if req.Type != "delete" {
		if targetCloud {
			if !numericID.MatchString(req.DestPath) {
				return nil, fmt.Errorf("无效115目标目录")
			}
			params["destId"] = req.DestPath
		} else {
			resolved, err := s.Roots.ResolveFollow(req.DestRoot, req.DestPath)
			if err != nil {
				return nil, err
			}
			info, err := os.Stat(resolved.Actual.Abs)
			if err != nil || !info.IsDir() {
				return nil, fmt.Errorf("目标不是目录")
			}
			params["localDest"] = resolved.Actual.Abs
		}
	}
	return params, nil
}

func (s *Service) operationHandler(w http.ResponseWriter, r *http.Request, method string) {
	w.Header().Set("Cache-Control", "no-store")
	user, ok := auth.CurrentUser(r.Context())
	if !ok {
		respond(w, 401, nil, "authentication required")
		return
	}
	var req operationRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		respond(w, 400, nil, "invalid request")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	if method == "ops.create" {
		preview, ok := s.operationPreviews[req.PreviewToken]
		if !ok || preview.Actor != user.ID || req.AccountID != preview.Request.AccountID || time.Now().After(preview.Expires) || preview.Plan.HasConflict {
			respond(w, 409, nil, "预览已失效，请重新预览")
			return
		}
		data, err := s.Provider.Call(ctx, "ops.plan", preview.Params, nil)
		var fresh operationPlan
		if err == nil {
			err = json.Unmarshal(data, &fresh)
		}
		if err != nil {
			respond(w, 502, nil, err.Error())
			return
		}
		if fresh.HasConflict || fresh.Revision != preview.Plan.Revision {
			respond(w, 409, nil, "源文件、账号或目标已变化，请重新预览")
			return
		}
		if ctx.Err() != nil {
			return
		}
		id := jobs.NewID()
		if err := s.Store.Create(r.Context(), jobs.Job{ID: id, AccountID: preview.Request.AccountID, Type: preview.Request.Type, ActorID: user.ID, SourceRootID: preview.Request.SourceRoot, DestRootID: preview.Request.DestRoot, ProgressTotal: len(fresh.Entries)}); err != nil {
			respond(w, 500, nil, err.Error())
			return
		}
		delete(s.operationPreviews, req.PreviewToken)
		go s.run(id, "ops.execute", map[string]any{}, fresh.Entries)
		respond(w, 201, map[string]string{"id": id}, "")
		return
	}
	params, err := s.operationParams(req)
	if err != nil {
		respond(w, 400, nil, err.Error())
		return
	}
	data, err := s.Provider.Call(ctx, "ops.plan", params, nil)
	if err != nil {
		respond(w, 502, nil, err.Error())
		return
	}
	var plan operationPlan
	if ctx.Err() != nil {
		return
	}
	if err = json.Unmarshal(data, &plan); err != nil {
		respond(w, 502, nil, "115预览响应无效")
		return
	}
	if len(plan.Items) != len(req.Sources) || (!plan.HasConflict && (len(plan.Entries) != len(req.Sources) || plan.Revision == "")) {
		respond(w, 502, nil, "115预览不完整")
		return
	}
	for key, value := range s.operationPreviews {
		if time.Now().After(value.Expires) {
			delete(s.operationPreviews, key)
		}
	}
	if len(s.operationPreviews) >= 128 {
		for key := range s.operationPreviews {
			delete(s.operationPreviews, key)
			break
		}
	}
	token := jobs.NewID()
	s.operationPreviews[token] = operationPreview{Actor: user.ID, Expires: time.Now().Add(15 * time.Minute), Request: req, Params: params, Plan: plan}
	respond(w, 200, map[string]any{"items": plan.Items, "hasConflict": plan.HasConflict, "previewToken": token}, "")
}
