package links

import (
	"context"
	"errors"
	"fmt"

	"github.com/little6neko/filebutler/internal/jobs"
)

var errLinkJobCancellationRequested = errors.New("link_job_cancellation_requested")

type GroupExecutor interface {
	ExecuteGroup(context.Context, string, PlanGroup, ExecutionHooks) error
}

type Runner struct {
	Store    jobs.Store
	Executor GroupExecutor
}

type storeUpdateError struct {
	err error
}

func (err *storeUpdateError) Error() string {
	return err.err.Error()
}

func (err *storeUpdateError) Unwrap() error {
	return err.err
}

func (runner Runner) Run(ctx context.Context, jobID string, groups []PlanGroup) error {
	if err := runner.Store.MarkRunning(ctx, jobID); err != nil {
		return err
	}
	job, err := runner.Store.Get(ctx, jobID)
	if errors.Is(err, jobs.ErrJobNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if job.Status == jobs.StatusCancelRequested {
		return runner.Store.Finish(context.Background(), jobID, jobs.StatusCanceled, "")
	}
	if job.Status != jobs.StatusRunning {
		return nil
	}
	if runner.Executor == nil {
		err := errors.New("link executor is unavailable")
		_ = runner.Store.Finish(context.Background(), jobID, jobs.StatusFailed, "link operation failed")
		return err
	}

	hadFailures := false
	for _, group := range groups {
		if err := ctx.Err(); err != nil {
			_ = runner.Store.Finish(context.Background(), jobID, jobs.StatusCanceled, "")
			return err
		}
		cancel, err := runner.Store.IsCancelRequested(ctx, jobID)
		if err != nil {
			_ = runner.Store.Finish(context.Background(), jobID, jobs.StatusFailed, "link operation failed")
			return err
		}
		if cancel {
			return runner.Store.Finish(context.Background(), jobID, jobs.StatusCanceled, "")
		}

		reported := 0
		groupHadFailure := false
		hooks := ExecutionHooks{
			BeforeStep: func(PlanStep) error {
				if err := ctx.Err(); err != nil {
					return err
				}
				cancel, err := runner.Store.IsCancelRequested(context.Background(), jobID)
				if err != nil {
					return &storeUpdateError{err: err}
				}
				if cancel {
					return errLinkJobCancellationRequested
				}
				return nil
			},
			Report: func(_ PlanStep, itemErr error) error {
				if reported >= len(group.Steps) {
					return &storeUpdateError{err: errors.New("link executor reported too many steps")}
				}
				safeErr := safeProgressError(itemErr)
				if err := runner.Store.RecordProgress(context.Background(), jobID, safeErr); err != nil {
					return &storeUpdateError{err: err}
				}
				reported++
				if itemErr != nil {
					groupHadFailure = true
				}
				return nil
			},
		}

		groupErr := runner.Executor.ExecuteGroup(ctx, jobID, group, hooks)
		var updateErr *storeUpdateError
		if errors.As(groupErr, &updateErr) {
			_ = runner.Store.Finish(context.Background(), jobID, jobs.StatusFailed, "link operation failed")
			return updateErr.err
		}
		cancel, cancelErr := runner.Store.IsCancelRequested(context.Background(), jobID)
		if cancelErr != nil {
			_ = runner.Store.Finish(context.Background(), jobID, jobs.StatusFailed, "link operation failed")
			return cancelErr
		}
		if cancel || errors.Is(groupErr, errLinkJobCancellationRequested) || errors.Is(groupErr, context.Canceled) || errors.Is(groupErr, context.DeadlineExceeded) {
			finishErr := runner.Store.Finish(context.Background(), jobID, jobs.StatusCanceled, "")
			if ctx.Err() != nil {
				return errors.Join(ctx.Err(), finishErr)
			}
			return finishErr
		}
		if groupErr != nil {
			groupHadFailure = true
		}
		if reported < len(group.Steps) {
			fillErr := groupErr
			if fillErr == nil {
				fillErr = errors.New("link executor did not report every step")
				groupHadFailure = true
			}
			for reported < len(group.Steps) {
				if err := runner.Store.RecordProgress(context.Background(), jobID, safeProgressError(fillErr)); err != nil {
					_ = runner.Store.Finish(context.Background(), jobID, jobs.StatusFailed, "link operation failed")
					return err
				}
				reported++
			}
		}
		if groupHadFailure {
			hadFailures = true
		}
	}

	cancel, err := runner.Store.IsCancelRequested(context.Background(), jobID)
	if err != nil {
		_ = runner.Store.Finish(context.Background(), jobID, jobs.StatusFailed, "link operation failed")
		return err
	}
	if cancel {
		return runner.Store.Finish(context.Background(), jobID, jobs.StatusCanceled, "")
	}
	if hadFailures {
		return runner.Store.Finish(context.Background(), jobID, jobs.StatusCompletedWithErrors, "")
	}
	return runner.Store.Finish(context.Background(), jobID, jobs.StatusCompleted, "")
}

func safeProgressError(err error) error {
	if err == nil {
		return nil
	}
	var cleanupError *StagingCleanupError
	if errors.As(err, &cleanupError) {
		return errors.New(cleanupError.Error())
	}
	switch {
	case errors.Is(err, ErrSourceChanged):
		return errors.New("link source changed")
	case errors.Is(err, ErrTargetExists):
		return errors.New("link destination already exists")
	case errors.Is(err, ErrPlanConflict):
		return errors.New("link plan has conflicts")
	default:
		return fmt.Errorf("link operation failed")
	}
}
