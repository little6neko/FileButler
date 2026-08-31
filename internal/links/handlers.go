package links

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
)

const maxLinkRequestBodyBytes = 1 << 20

func PreviewHandler(planner Planner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request Request
		if err := decodeLinkJSON(w, r, &request); err != nil {
			writeLinkDecodeError(w, err)
			return
		}
		plan, err := planner.Plan(r.Context(), request)
		if err != nil {
			writeLinkPlanningError(w, err)
			return
		}
		writeLinkData(w, http.StatusOK, plan.Public())
	}
}

func CreateJobHandler(planner Planner, store jobs.Store, runner Runner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := auth.CurrentUser(r.Context())
		if !ok {
			writeLinkError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		var request JobRequest
		if err := decodeLinkJSON(w, r, &request); err != nil {
			writeLinkDecodeError(w, err)
			return
		}
		if !revisionPattern.MatchString(request.PreviewRevision) {
			writeLinkError(w, http.StatusBadRequest, "invalid_request", "previewRevision is required")
			return
		}
		plan, err := planner.Plan(r.Context(), request.PreviewRequest())
		if err != nil {
			writeLinkPlanningError(w, err)
			return
		}
		if request.PreviewRevision != plan.Preview.PreviewRevision {
			writeLinkErrorWithData(w, http.StatusConflict, "stale_preview", "link plan changed", plan.Public())
			return
		}
		if plan.Preview.HasConflict {
			writeLinkErrorWithData(w, http.StatusConflict, "plan_conflict", "link plan has conflicts", plan.Public())
			return
		}

		jobID := jobs.NewID()
		if err := store.Create(r.Context(), jobs.Job{
			ID:            jobID,
			Type:          string(plan.Preview.Type),
			Status:        jobs.StatusPending,
			ActorID:       user.ID,
			SourceRootID:  plan.Preview.SourceRoot,
			DestRootID:    plan.Preview.DestRoot,
			ProgressTotal: plan.Preview.ProgressTotal,
		}); err != nil {
			writeLinkError(w, http.StatusInternalServerError, "operation_failed", "unable to create the link job")
			return
		}
		runner.Store = store
		go func() {
			_ = runner.Run(context.Background(), jobID, plan.Groups)
		}()
		writeLinkData(w, http.StatusCreated, map[string]string{"id": jobID})
	}
}

func decodeLinkJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxLinkRequestBodyBytes)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func writeLinkDecodeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeLinkError(w, http.StatusRequestEntityTooLarge, "request_too_large", "request body is too large")
		return
	}
	writeLinkError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
}

func writeLinkPlanningError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidRequest),
		errors.Is(err, ErrNotDirectory),
		errors.Is(err, roots.ErrUnknownRoot),
		errors.Is(err, roots.ErrInvalidPath),
		errors.Is(err, roots.ErrOutsideRoot),
		os.IsNotExist(err):
		writeLinkError(w, http.StatusBadRequest, "invalid_request", "the link request contains an invalid root or path")
	case os.IsPermission(err):
		writeLinkError(w, http.StatusForbidden, "permission_denied", "the source or destination cannot be accessed")
	default:
		writeLinkError(w, http.StatusInternalServerError, "operation_failed", "unable to build the link plan")
	}
}

func writeLinkData(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": value})
}

func writeLinkError(w http.ResponseWriter, status int, code string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}

func writeLinkErrorWithData(w http.ResponseWriter, status int, code string, message string, data Preview) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": code, "message": message},
		"data":  data,
	})
}
