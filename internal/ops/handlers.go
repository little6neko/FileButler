package ops

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
)

func DryRunHandler(planner Planner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req Request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
			return
		}
		plan, err := planner.Plan(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		writeData(w, http.StatusOK, plan)
	}
}

func CreateJobHandler(planner Planner, store jobs.Store, runner jobs.Runner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req Request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
			return
		}
		plan, err := planner.Plan(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		if plan.HasConflict {
			writeData(w, http.StatusConflict, plan)
			return
		}
		user, ok := auth.CurrentUser(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		planJSON, _ := json.Marshal(plan)
		id := NewJobID()
		if err := store.Create(r.Context(), jobs.Job{
			ID:               id,
			Type:             string(req.Type),
			Status:           jobs.StatusPending,
			ActorID:          user.ID,
			SourceRootID:     req.SourceRoot,
			DestRootID:       req.DestRoot,
			PlanJSON:         string(planJSON),
			RootSnapshotJSON: "{}",
			ProgressTotal:    len(plan.Items),
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "operation_failed", err.Error())
			return
		}
		items := make([]jobs.ExecutableItem, 0, len(plan.Items))
		for i, item := range plan.Items {
			items = append(items, jobs.ExecutableItem{Index: i, Action: string(item.Operation), SourceRoot: item.SourceRoot, SourcePath: item.SourcePath, DestRoot: item.DestRoot, DestPath: item.DestPath, UndoJSON: "{}"})
		}
		go func() { _ = runner.Run(context.Background(), id, items) }()
		writeData(w, http.StatusCreated, map[string]string{"id": id})
	}
}

type JobExecutor struct {
	Executor Executor
}

func (e JobExecutor) ExecuteItem(ctx context.Context, item jobs.ExecutableItem) error {
	return e.Executor.Execute(ctx, PlanItem{
		Operation:  OperationType(item.Action),
		SourceRoot: item.SourceRoot,
		SourcePath: item.SourcePath,
		DestRoot:   item.DestRoot,
		DestPath:   item.DestPath,
	})
}

func NewJobID() string {
	return "job_" + strconvFormatInt(time.Now().UnixNano())
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

func strconvFormatInt(v int64) string {
	if v == 0 {
		return "0"
	}
	var buf [24]byte
	pos := len(buf)
	for v > 0 {
		pos--
		buf[pos] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[pos:])
}
