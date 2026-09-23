package cloud115

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/little6neko/filebutler/internal/storage"
	"log"
	"path/filepath"
	"time"
)

func (b *Bridge) storageReply(p *workerProcess, msg message) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	data, err := b.storageCall(ctx, msg.Method, msg.Params)
	reply := map[string]any{"storageReply": msg.StorageID, "data": data}
	if err != nil {
		reply = map[string]any{"storageReply": msg.StorageID, "error": "private storage operation failed"}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.process == p {
		if e := json.NewEncoder(p.in).Encode(reply); e != nil {
			_ = p.cmd.Process.Kill()
		}
	}
}
func (b *Bridge) storageCall(ctx context.Context, method string, raw json.RawMessage) (any, error) {
	switch method {
	case "credential.get":
		return b.database.Cookie(ctx)
	case "credential.set":
		var params struct {
			Cookie string `json:"cookie"`
		}
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, err
		}
		return nil, b.database.SetCookie(ctx, params.Cookie)
	case "credential.delete":
		return nil, b.database.DeleteCookie(ctx)
	case "cache.warning":
		log.Print("115 hash cache unavailable; using uncached transfer")
		return nil, nil
	case "hash.get", "hash.put", "hash.invalidate":
		var params struct {
			Path    string `json:"path"`
			Account string `json:"account"`
			FileID  string `json:"fileId"`
			Version string `json:"version"`
			SHA1    string `json:"sha1"`
			Origin  string `json:"origin"`
		}
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, err
		}
		h := storage.Hash{Version: params.Version, SHA1: params.SHA1, Origin: params.Origin}
		if params.Account != "" {
			if !numericID.MatchString(params.Account) || params.FileID != "" && !numericID.MatchString(params.FileID) {
				return nil, errors.New("invalid cloud hash identity")
			}
			h.Scope = "115:" + params.Account
			h.Path = params.FileID
		} else {
			if !filepath.IsAbs(params.Path) {
				return nil, errors.New("invalid local hash path")
			}
			mapped, err := b.resolver.MapPath(params.Path)
			if err != nil {
				return nil, errors.New("unmapped local hash path")
			}
			h.Scope = storage.LocalScope(mapped.Root.ID, mapped.Root.Path)
			h.Path = filepath.ToSlash(mapped.Rel)
		}
		if method == "hash.get" {
			return b.database.Hash(ctx, h)
		}
		if method == "hash.invalidate" {
			return nil, b.database.Invalidate(ctx, h.Scope, h.Path)
		}
		return nil, b.database.PutHash(ctx, h)
	default:
		return nil, errors.New("unknown storage method")
	}
}
