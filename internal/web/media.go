package web

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/little6neko/filebutler/internal/roots"
)

func mediaHandler(resolver roots.Resolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rel := r.URL.Query().Get("path")
		mediaType := mediaContentType(rel)
		if mediaType == "" {
			Error(w, http.StatusUnsupportedMediaType, "unsupported_media", "media preview only supports image and video files")
			return
		}
		resolved, err := resolver.ResolveForWrite(r.URL.Query().Get("rootId"), rel)
		if err != nil {
			Error(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		file, err := os.Open(resolved.Abs)
		if err != nil {
			status := http.StatusInternalServerError
			code := "operation_failed"
			if os.IsNotExist(err) {
				status = http.StatusNotFound
				code = "not_found"
			}
			Error(w, status, code, err.Error())
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			Error(w, http.StatusInternalServerError, "operation_failed", err.Error())
			return
		}
		if info.IsDir() {
			Error(w, http.StatusBadRequest, "invalid_request", "media path must be a file")
			return
		}
		w.Header().Set("Content-Type", mediaType)
		w.Header().Set("Cache-Control", "private, no-store")
		http.ServeContent(w, r, info.Name(), info.ModTime(), file)
	}
}

func mediaContentType(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	if !supportedMediaExtensions[ext] {
		return ""
	}
	contentType := mime.TypeByExtension(ext)
	if contentType == "" && ext == ".mkv" {
		return "video/x-matroska"
	}
	if semicolon := strings.Index(contentType, ";"); semicolon >= 0 {
		contentType = contentType[:semicolon]
	}
	return contentType
}

var supportedMediaExtensions = map[string]bool{
	".avif": true,
	".bmp":  true,
	".gif":  true,
	".jpeg": true,
	".jpg":  true,
	".png":  true,
	".svg":  true,
	".webp": true,
	".m4v":  true,
	".mkv":  true,
	".mov":  true,
	".mp4":  true,
	".ogv":  true,
	".ogg":  true,
	".webm": true,
}
