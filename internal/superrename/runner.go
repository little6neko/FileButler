package superrename

import (
	"context"
	"errors"

	"github.com/little6neko/filebutler/internal/jobs"
)

type Runner struct {
	Store    jobs.Store
	Executor GroupExecutor
}

func (r Runner) Run(ctx context.Context, jobID string, rootID string, groups []PlanGroup) error {
	if err := r.Store.MarkRunning(ctx, jobID); err != nil {
		return err
	}
	job, err := r.Store.Get(ctx, jobID)
	if errors.Is(err, jobs.ErrJobNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if job.Status == jobs.StatusCancelRequested {
		return r.Store.Finish(ctx, jobID, jobs.StatusCanceled, "")
	}
	if job.Status != jobs.StatusRunning {
		return nil
	}

	failures := 0
	for _, group := range groups {
		if err := ctx.Err(); err != nil {
			_ = r.Store.Finish(context.Background(), jobID, jobs.StatusCanceled, err.Error())
			return err
		}
		cancel, err := r.Store.IsCancelRequested(ctx, jobID)
		if err != nil {
			_ = r.Store.Finish(context.Background(), jobID, jobs.StatusFailed, err.Error())
			return err
		}
		if cancel {
			return r.Store.Finish(context.Background(), jobID, jobs.StatusCanceled, "")
		}

		groupErr := r.Executor.ExecuteGroup(ctx, jobID, rootID, group)
		if groupErr != nil {
			failures += len(group.Items)
		}
		for range group.Items {
			if err := r.Store.RecordProgress(context.Background(), jobID, groupErr); err != nil {
				_ = r.Store.Finish(context.Background(), jobID, jobs.StatusFailed, err.Error())
				return err
			}
		}
	}

	cancel, err := r.Store.IsCancelRequested(context.Background(), jobID)
	if err != nil {
		_ = r.Store.Finish(context.Background(), jobID, jobs.StatusFailed, err.Error())
		return err
	}
	if cancel {
		return r.Store.Finish(context.Background(), jobID, jobs.StatusCanceled, "")
	}
	if failures > 0 {
		return r.Store.Finish(context.Background(), jobID, jobs.StatusCompletedWithErrors, "")
	}
	return r.Store.Finish(context.Background(), jobID, jobs.StatusCompleted, "")
}
