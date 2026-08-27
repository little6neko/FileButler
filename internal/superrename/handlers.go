package superrename

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/ops"
	"github.com/little6neko/filebutler/internal/roots"
)

const maxRequestBodyBytes = 8 << 20

type PreviewRequest struct {
	RootID        string `json:"rootId"`
	DirectoryPath string `json:"directoryPath"`
}

type CreateJobRequest struct {
	RootID        string   `json:"rootId"`
	DirectoryPath string   `json:"directoryPath"`
	SelectedPaths []string `json:"selectedPaths"`
}

func PreviewHandler(scanner Scanner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request PreviewRequest
		if err := decodeStrictJSON(w, r, &request); err != nil {
			writeDecodeError(w, err)
			return
		}
		if request.RootID == "" || request.DirectoryPath == "" {
			writeError(w, http.StatusBadRequest, "invalid_request", "rootId and directoryPath are required")
			return
		}
		inventory, err := scanner.Scan(r.Context(), request.RootID, request.DirectoryPath)
		if err != nil {
			writeScanError(w, err, false)
			return
		}
		writeData(w, http.StatusOK, inventory)
	}
}

func CreateJobHandler(scanner Scanner, planner Planner, store jobs.Store, runner Runner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request CreateJobRequest
		if err := decodeStrictJSON(w, r, &request); err != nil {
			writeDecodeError(w, err)
			return
		}
		if request.RootID == "" || request.DirectoryPath == "" {
			writeError(w, http.StatusBadRequest, "invalid_request", "rootId and directoryPath are required")
			return
		}
		user, ok := auth.CurrentUser(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		inventory, err := scanner.Scan(r.Context(), request.RootID, request.DirectoryPath)
		if err != nil {
			writeScanError(w, err, true)
			return
		}
		plan, err := planner.Build(inventory, request.SelectedPaths)
		switch {
		case errors.Is(err, ErrStaleSelection):
			writeError(w, http.StatusConflict, "stale_preview", "the directory changed; refresh the preview and confirm again")
			return
		case errors.Is(err, ErrEmptySelection), errors.Is(err, ErrInvalidSelection):
			writeError(w, http.StatusBadRequest, "invalid_request", "selectedPaths must contain unique preview candidates")
			return
		case err != nil:
			writeError(w, http.StatusInternalServerError, "operation_failed", "unable to build the SuperRename plan")
			return
		case plan.HasConflict:
			writeError(w, http.StatusConflict, "plan_conflict", "the selected files have target conflicts")
			return
		}

		jobID := ops.NewJobID()
		if err := store.Create(r.Context(), jobs.Job{
			ID:            jobID,
			Type:          "super_rename",
			Status:        jobs.StatusPending,
			ActorID:       user.ID,
			SourceRootID:  request.RootID,
			ProgressTotal: plan.Summary.SelectedCount,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "operation_failed", "unable to create the SuperRename job")
			return
		}
		go func() {
			_ = runner.Run(context.Background(), jobID, request.RootID, plan.Groups)
		}()
		writeData(w, http.StatusCreated, map[string]string{"id": jobID})
	}
}

func decodeStrictJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func writeDecodeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, "request_too_large", "request body is too large")
		return
	}
	writeError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
}

func writeScanError(w http.ResponseWriter, err error, staleContext bool) {
	switch {
	case errors.Is(err, roots.ErrUnknownRoot), errors.Is(err, roots.ErrInvalidPath), errors.Is(err, roots.ErrOutsideRoot):
		writeError(w, http.StatusBadRequest, "invalid_request", "the requested root or directory path is invalid")
	case os.IsPermission(err):
		writeError(w, http.StatusForbidden, "permission_denied", "the directory cannot be read")
	case staleContext && (os.IsNotExist(err) || errors.Is(err, ErrNotDirectory)):
		writeError(w, http.StatusConflict, "stale_preview", "the directory changed; refresh the preview and confirm again")
	case os.IsNotExist(err):
		writeError(w, http.StatusNotFound, "not_found", "the directory does not exist")
	case errors.Is(err, ErrNotDirectory):
		writeError(w, http.StatusBadRequest, "invalid_request", "the requested path is not a real directory")
	default:
		writeError(w, http.StatusInternalServerError, "operation_failed", "unable to scan the directory")
	}
}

func writeData(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": value})
}

func writeError(w http.ResponseWriter, status int, code string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}
