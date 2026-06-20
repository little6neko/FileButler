package rename

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/browser"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/ops"
	"github.com/little6neko/filebutler/internal/roots"
)

type HandlerRequest struct {
	RootID  string   `json:"rootId"`
	Paths   []string `json:"paths"`
	Options Options  `json:"options"`
}

type SingleRenameRequest struct {
	RootID  string   `json:"rootId"`
	Paths   []string `json:"paths"`
	NewName string   `json:"newName"`
}

func PreviewHandler(browser browser.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req HandlerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
			return
		}
		plan, err := BuildPlan(r.Context(), browser.Resolver, req)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		writeData(w, http.StatusOK, plan)
	}
}

func CreateJobHandler(browser browser.Service, store jobs.Store, runner jobs.Runner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req HandlerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
			return
		}
		plan, err := BuildPlan(r.Context(), browser.Resolver, req)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		if plan.HasConflict {
			writeData(w, http.StatusConflict, plan)
			return
		}
		createRenameJob(w, r, store, runner, req.RootID, plan)
	}
}

func SingleRenameCreateJobHandler(browser browser.Service, store jobs.Store, runner jobs.Runner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req SingleRenameRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
			return
		}
		inputs, err := resolveRenameInputs(r.Context(), browser.Resolver, req.RootID, req.Paths)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		plan, err := BuildSinglePlan(inputs, req.NewName, existingPathFunc(browser.Resolver, req.RootID))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		if plan.HasConflict {
			writeData(w, http.StatusConflict, plan)
			return
		}
		createRenameJob(w, r, store, runner, req.RootID, plan)
	}
}

func BuildPlan(ctx context.Context, resolver roots.Resolver, req HandlerRequest) (PlanResult, error) {
	inputs, err := resolveRenameInputs(ctx, resolver, req.RootID, req.Paths)
	if err != nil {
		return PlanResult{}, err
	}
	return Plan(inputs, req.Options, existingPathFunc(resolver, req.RootID))
}

func resolveRenameInputs(ctx context.Context, resolver roots.Resolver, rootID string, paths []string) ([]InputItem, error) {
	inputs := make([]InputItem, 0, len(paths))
	for _, rel := range paths {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		resolved, err := resolver.Resolve(rootID, rel)
		if err != nil {
			return nil, err
		}
		info, err := os.Lstat(resolved.Abs)
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, InputItem{RelativePath: rel, IsDir: info.IsDir()})
	}
	return inputs, nil
}

func existingPathFunc(resolver roots.Resolver, rootID string) func(path string) bool {
	return func(path string) bool {
		resolved, err := resolver.Resolve(rootID, filepath.ToSlash(path))
		if err != nil {
			return true
		}
		_, err = os.Lstat(resolved.Abs)
		return err == nil
	}
}

func createRenameJob(w http.ResponseWriter, r *http.Request, store jobs.Store, runner jobs.Runner, rootID string, plan PlanResult) {
	user, ok := auth.CurrentUser(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
		return
	}
	planJSON, _ := json.Marshal(plan)
	id := ops.NewJobID()
	if err := store.Create(r.Context(), jobs.Job{ID: id, Type: "rename", Status: jobs.StatusPending, ActorID: user.ID, SourceRootID: rootID, PlanJSON: string(planJSON), RootSnapshotJSON: "{}", ProgressTotal: len(plan.Items)}); err != nil {
		writeError(w, http.StatusInternalServerError, "operation_failed", err.Error())
		return
	}
	items := make([]jobs.ExecutableItem, 0, len(plan.Items))
	for i, item := range plan.Items {
		items = append(items, jobs.ExecutableItem{Index: i, Action: "rename", SourceRoot: rootID, SourcePath: item.SourcePath, DestRoot: rootID, DestPath: item.TargetPath, UndoJSON: "{}"})
	}
	go func() { _ = runner.Run(context.Background(), id, items) }()
	writeData(w, http.StatusCreated, map[string]string{"id": id})
}

type Executor struct {
	Resolver roots.Resolver
}

func (e Executor) ExecuteItem(ctx context.Context, item jobs.ExecutableItem) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	src, err := e.Resolver.ResolveForWrite(item.SourceRoot, item.SourcePath)
	if err != nil {
		return err
	}
	dest, err := e.Resolver.ResolveForWrite(item.DestRoot, item.DestPath)
	if err != nil {
		return err
	}
	return os.Rename(src.Abs, dest.Abs)
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
