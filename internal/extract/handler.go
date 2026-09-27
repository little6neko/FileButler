package extract

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
)

func Handler(service Service, store jobs.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		respond := func(status int, value any) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(value)
		}
		fail := func(status int, err error) {
			respond(status, map[string]any{"error": map[string]string{"code": "extract_failed", "message": err.Error()}})
		}
		user, ok := auth.CurrentUser(r.Context())
		if !ok {
			fail(http.StatusUnauthorized, errors.New("authentication required"))
			return
		}
		var req Request
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			fail(http.StatusBadRequest, errors.New("解压请求格式无效"))
			return
		}
		if err := service.Validate(req); err != nil {
			fail(http.StatusBadRequest, err)
			return
		}
		id := jobs.NewID()
		if err := store.Create(r.Context(), jobs.Job{ID: id, Type: "extract", ActorID: user.ID, SourceRootID: req.SourceRoot, DestRootID: req.DestRoot, ProgressTotal: 1}); err != nil {
			fail(http.StatusInternalServerError, err)
			return
		}
		// Password exists only in this task closure, never in job/event records.
		go run(service, store, id, req)
		respond(http.StatusCreated, map[string]any{"data": map[string]string{"id": id}})
	}
}

func run(service Service, store jobs.Store, id string, req Request) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := store.MarkRunning(ctx, id); err != nil {
		return
	}
	ctx = jobs.WithReporter(ctx, func(progress jobs.TransferProgress) error { return store.ReportTransfer(ctx, id, progress) })
	// Cancel also interrupts decoder listing and a decoder blocked on output.
	stopped := make(chan struct{})
	defer close(stopped)
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopped:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				requested, err := store.IsCancelRequested(context.Background(), id)
				if err != nil || requested {
					cancel()
					return
				}
			}
		}
	}()
	err := service.Execute(ctx, req)
	status, message := jobs.StatusCompleted, ""
	if err != nil {
		status, message = jobs.StatusFailed, err.Error()
		if errors.Is(err, context.Canceled) {
			status = jobs.StatusCanceled
		}
	}
	if err == nil {
		_ = store.RecordProgress(context.Background(), id, nil)
	}
	_ = store.Finish(context.Background(), id, status, message)
}
