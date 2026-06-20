package jobs

import (
	"context"

	"github.com/little6neko/filebutler/internal/audit"
)

type ExecutableItem struct {
	Index      int
	Action     string
	SourceRoot string
	SourcePath string
	DestRoot   string
	DestPath   string
	UndoJSON   string
}

type ItemExecutor interface {
	ExecuteItem(ctx context.Context, item ExecutableItem) error
}

type Runner struct {
	Store    Store
	Audit    audit.Store
	Executor ItemExecutor
}

func (r Runner) Run(ctx context.Context, jobID string, items []ExecutableItem) error {
	if err := r.Store.MarkRunning(ctx, jobID); err != nil {
		return err
	}
	job, _, err := r.Store.Get(ctx, jobID)
	if err != nil {
		return err
	}
	failures := 0
	for _, item := range items {
		cancel, err := r.Store.IsCancelRequested(ctx, jobID)
		if err != nil {
			_ = r.Store.Finish(ctx, jobID, StatusFailed, err.Error())
			return err
		}
		if cancel {
			return r.Store.Finish(ctx, jobID, StatusCanceled, "")
		}
		if err := ctx.Err(); err != nil {
			_ = r.Store.Finish(ctx, jobID, StatusCanceled, err.Error())
			return err
		}
		execErr := r.Executor.ExecuteItem(ctx, item)
		result := ItemResult{
			JobID:      jobID,
			Index:      item.Index,
			SourcePath: item.SourcePath,
			DestPath:   item.DestPath,
			Status:     "completed",
			UndoJSON:   item.UndoJSON,
		}
		if result.UndoJSON == "" {
			result.UndoJSON = "{}"
		}
		if execErr != nil {
			failures++
			result.Status = "failed"
			result.ErrorCode = "operation_failed"
			result.ErrorMessage = execErr.Error()
		}
		if err := r.Store.AddItemResult(ctx, result); err != nil {
			_ = r.Store.Finish(ctx, jobID, StatusFailed, err.Error())
			return err
		}
		if execErr == nil {
			if err := r.Audit.Insert(ctx, audit.Record{
				ActorID:      job.ActorID,
				Action:       item.Action,
				SourceRootID: item.SourceRoot,
				SourcePath:   item.SourcePath,
				DestRootID:   item.DestRoot,
				DestPath:     item.DestPath,
				JobID:        jobID,
				DetailJSON:   "{}",
			}); err != nil {
				_ = r.Store.Finish(ctx, jobID, StatusFailed, err.Error())
				return err
			}
		}
		if err := r.Store.IncrementProgress(ctx, jobID); err != nil {
			_ = r.Store.Finish(ctx, jobID, StatusFailed, err.Error())
			return err
		}
	}
	if failures > 0 {
		return r.Store.Finish(ctx, jobID, StatusCompletedWithErrors, "")
	}
	return r.Store.Finish(ctx, jobID, StatusCompleted, "")
}
