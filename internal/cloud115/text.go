package cloud115

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/details"
	"github.com/little6neko/filebutler/internal/textfile"
)

func (s *Service) textPreviewHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if _, ok := auth.CurrentUser(r.Context()); !ok {
		respond(w, 401, nil, "authentication required")
		return
	}
	var req struct {
		AccountID string `json:"accountId"`
		ID        string `json:"id"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&req) != nil || !numericID.MatchString(req.AccountID) || req.AccountID == "0" || !numericID.MatchString(req.ID) || req.ID == "0" {
		respond(w, 400, nil, "无效的账号或文件ID")
		return
	}
	if decoder.Decode(new(any)) != io.EOF {
		respond(w, 400, nil, "invalid request")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	release, err := details.Acquire(ctx)
	if err != nil {
		respond(w, 503, nil, "文本预览请求已取消或超时")
		return
	}
	defer release()
	// URL is generated from the authenticated account and stable file ID, never
	// supplied by the browser. Slow downloads do not hold the account browse lock.
	data, err := s.Provider.Call(ctx, "preview.url", map[string]any{"accountId": req.AccountID, "id": req.ID, "userAgent": r.UserAgent()}, nil)
	if err != nil {
		respond(w, 502, nil, err.Error())
		return
	}
	var link struct {
		URL       string `json:"url"`
		Name      string `json:"name"`
		Size      int64  `json:"size"`
		AccountID string `json:"accountId"`
	}
	if json.Unmarshal(data, &link) != nil {
		respond(w, 502, nil, "无效的115预览响应")
		return
	}
	if link.AccountID != req.AccountID {
		respond(w, 409, nil, "115账号已变化，请重新打开预览")
		return
	}
	if !textfile.IsSupported(link.Name) {
		respond(w, 400, nil, "不支持的文本文件类型")
		return
	}
	if link.Size < 0 {
		respond(w, 502, nil, "无效的115文件大小")
		return
	}
	if link.Size > textfile.MaxFileSize {
		respond(w, 413, nil, "文本超过10 MiB预览上限，请直接下载。")
		return
	}
	raw, err := details.ReadRemote(ctx, link.URL, r.UserAgent(), textfile.MaxFileSize)
	if errors.Is(err, details.ErrRemoteTooLarge) {
		respond(w, 413, nil, "文本超过10 MiB预览上限，请直接下载。")
		return
	}
	if err != nil {
		respond(w, 502, nil, err.Error())
		return
	}
	if int64(len(raw)) != link.Size {
		respond(w, 502, nil, "115文本内容不完整或文件已变化，请重新打开预览")
		return
	}
	decoded, err := textfile.DecodeText(raw)
	if err != nil {
		respond(w, 400, nil, "文件含二进制内容或无效文本编码，无法作为文本预览")
		return
	}
	respond(w, 200, map[string]any{"accountId": req.AccountID, "document": textfile.Document{Content: decoded.Content, Encoding: decoded.Encoding, LineEnding: decoded.LineEnding, PreferredLineEnding: decoded.PreferredLineEnding, ByteSize: int64(len(raw)), Revision: "cloud-read-only"}}, "")
}
