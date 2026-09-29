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

type TransferScanner interface {
	ScanTransfer(context.Context, ExecutableItem, bool) (TransferTotals, error)
}

type Runner struct {
	Store    Store
	Executor ItemExecutor
}

func (r Runner) Run(ctx context.Context, jobID string, items []ExecutableItem) error {
	ctx = WithReporter(ctx, func(progress TransferProgress) error { return r.Store.ReportTransfer(ctx, jobID, progress) })
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
	var batch *TransferBatch
	if scanner, ok := r.Executor.(TransferScanner); ok && (job.Type == "copy" || job.Type == "move") {
		batch = NewTransferBatch(ctx, len(items), func(p TransferProgress) error { return r.Store.ReportTransfer(ctx, jobID, p) }, func(ctx context.Context, i int, moved bool) (TransferTotals, error) {
			return scanner.ScanTransfer(ctx, items[i], moved)
		})
		defer batch.Close()
	}
	failures := 0
	for i, item := range items {
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
		itemCtx := ctx
		if batch != nil {
			itemCtx = WithReporter(ctx, func(p TransferProgress) error { return batch.Report(i, p) })
		}
		execErr := r.Executor.ExecuteItem(itemCtx, item)
		if batch != nil {
			batch.CompleteItem(i, execErr)
		}
		if errors.Is(execErr, context.Canceled) {
			return r.Store.Finish(context.Background(), jobID, StatusCanceled, "")
		}
		if execErr != nil {
			failures++
		}
		if err := r.Store.RecordProgress(ctx, jobID, execErr); err != nil {
			_ = r.Store.Finish(context.Background(), jobID, StatusFailed, err.Error())
			return err
		}
	}
	if batch != nil {
		batch.Close()
	}
	if failures > 0 {
		return r.Store.Finish(context.Background(), jobID, StatusCompletedWithErrors, "")
	}
	return r.Store.Finish(context.Background(), jobID, StatusCompleted, "")
}
