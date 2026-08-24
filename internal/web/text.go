package web

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/textfile"
)

const textRequestBodyLimit int64 = 32 << 20

var errTextRequestBodyTooLarge = errors.New("text request body is too large")

type textSavePayload struct {
	RootID     string              `json:"rootId"`
	Path       string              `json:"path"`
	Content    string              `json:"content"`
	Encoding   textfile.Encoding   `json:"encoding"`
	LineEnding textfile.LineEnding `json:"lineEnding"`
	Revision   string              `json:"revision"`
	Force      bool                `json:"force"`
}

func textReadHandler(service *textfile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rootID := r.URL.Query().Get("rootId")
		path := r.URL.Query().Get("path")
		if rootID == "" || path == "" {
			Error(w, http.StatusBadRequest, "invalid_request", "rootId and path are required")
			return
		}
		document, err := service.Read(rootID, path)
		if err != nil {
			writeTextError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		Data(w, http.StatusOK, document)
	}
}

func textSaveHandler(service *textfile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload, err := decodeTextSavePayload(w, r)
		if err != nil {
			if errors.Is(err, errTextRequestBodyTooLarge) {
				Error(w, http.StatusRequestEntityTooLarge, "file_too_large", err.Error())
			} else {
				Error(w, http.StatusBadRequest, "invalid_request", err.Error())
			}
			return
		}
		result, err := service.Save(textfile.SaveRequest{
			RootID:     payload.RootID,
			Path:       payload.Path,
			Content:    payload.Content,
			Encoding:   payload.Encoding,
			LineEnding: payload.LineEnding,
			Revision:   payload.Revision,
			Force:      payload.Force,
		})
		if err != nil {
			writeTextError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		Data(w, http.StatusOK, result)
	}
}

func decodeTextSavePayload(w http.ResponseWriter, r *http.Request) (textSavePayload, error) {
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, textRequestBodyLimit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var payload textSavePayload
	if err := decoder.Decode(&payload); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			return textSavePayload{}, errTextRequestBodyTooLarge
		}
		return textSavePayload{}, fmt.Errorf("invalid JSON body: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return textSavePayload{}, errors.New("request body contains multiple JSON values")
		}
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			return textSavePayload{}, errTextRequestBodyTooLarge
		}
		return textSavePayload{}, fmt.Errorf("invalid trailing JSON: %w", err)
	}
	if payload.RootID == "" || payload.Path == "" {
		return textSavePayload{}, errors.New("rootId and path are required")
	}
	if !isTextEncoding(payload.Encoding) {
		return textSavePayload{}, textfile.ErrUnsupportedEncoding
	}
	if !isWritableLineEnding(payload.LineEnding) {
		return textSavePayload{}, textfile.ErrUnsupportedLineEnding
	}
	if !isTextRevision(payload.Revision) {
		return textSavePayload{}, errors.New("revision must be a SHA-256 text revision")
	}
	return payload, nil
}

func isTextEncoding(encoding textfile.Encoding) bool {
	switch encoding {
	case textfile.EncodingUTF8, textfile.EncodingUTF8BOM, textfile.EncodingUTF16LEBOM,
		textfile.EncodingUTF16BEBOM, textfile.EncodingGB18030:
		return true
	default:
		return false
	}
}

func isWritableLineEnding(lineEnding textfile.LineEnding) bool {
	return lineEnding == textfile.LineEndingLF || lineEnding == textfile.LineEndingCRLF || lineEnding == textfile.LineEndingCR
}

func isTextRevision(revision string) bool {
	const prefix = "sha256:"
	if !strings.HasPrefix(revision, prefix) || len(revision) != len(prefix)+64 {
		return false
	}
	_, err := hex.DecodeString(revision[len(prefix):])
	return err == nil
}

func writeTextError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	code := "operation_failed"
	switch {
	case errors.Is(err, os.ErrPermission):
		status = http.StatusForbidden
		code = "permission_denied"
	case errors.Is(err, textfile.ErrNotFound), errors.Is(err, os.ErrNotExist):
		status = http.StatusNotFound
		code = "not_found"
	case errors.Is(err, textfile.ErrRevisionConflict):
		status = http.StatusConflict
		code = "revision_conflict"
	case errors.Is(err, textfile.ErrTooLarge):
		status = http.StatusRequestEntityTooLarge
		code = "file_too_large"
	case errors.Is(err, textfile.ErrUnsupportedText), errors.Is(err, textfile.ErrInvalidText):
		status = http.StatusUnsupportedMediaType
		code = "unsupported_text"
	case errors.Is(err, textfile.ErrNotRegular), errors.Is(err, textfile.ErrTargetChanged),
		errors.Is(err, textfile.ErrUnsupportedEncoding), errors.Is(err, textfile.ErrUnsupportedLineEnding),
		errors.Is(err, roots.ErrUnknownRoot), errors.Is(err, roots.ErrOutsideRoot), errors.Is(err, roots.ErrInvalidPath):
		status = http.StatusBadRequest
		code = "invalid_request"
	}
	Error(w, status, code, err.Error())
}
