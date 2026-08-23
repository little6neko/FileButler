package jobs

import (
	"context"
	"errors"
)

type ExecutableItem struct {
	Action     string
	SourceRoot string
	SourcePath string
	DestRoot   string
	DestPath   string
}

type ItemExecutor interface {
	ExecuteItem(ctx context.Context, item ExecutableItem) error
}

type Runner struct {
	Store    Store
	Executor ItemExecutor
}

func (r Runner) Run(ctx context.Context, jobID string, items []ExecutableItem) error {
	if err := r.Store.MarkRunning(ctx, jobID); err != nil {
		return err
	}
	job, err := r.Store.Get(ctx, jobID)
	if errors.Is(err, ErrJobNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if job.Status == StatusCancelRequested {
		return r.Store.Finish(ctx, jobID, StatusCanceled, "")
	}
	if job.Status != StatusRunning {
		return nil
	}
	failures := 0
	for _, item := range items {
		if err := ctx.Err(); err != nil {
			_ = r.Store.Finish(context.Background(), jobID, StatusCanceled, err.Error())
			return err
		}
		cancel, err := r.Store.IsCancelRequested(ctx, jobID)
		if err != nil {
			_ = r.Store.Finish(context.Background(), jobID, StatusFailed, err.Error())
			return err
		}
		if cancel {
			return r.Store.Finish(ctx, jobID, StatusCanceled, "")
		}
		execErr := r.Executor.ExecuteItem(ctx, item)
		if execErr != nil {
			failures++
		}
		if err := r.Store.RecordProgress(ctx, jobID, execErr); err != nil {
			_ = r.Store.Finish(context.Background(), jobID, StatusFailed, err.Error())
			return err
		}
	}
	if failures > 0 {
		return r.Store.Finish(context.Background(), jobID, StatusCompletedWithErrors, "")
	}
	return r.Store.Finish(context.Background(), jobID, StatusCompleted, "")
}
