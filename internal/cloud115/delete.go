package cloud115

import (
	"context"
	"errors"
	"time"

	"github.com/little6neko/filebutler/internal/jobs"
)

// Each account has its own Service. Only explicit delete jobs share this slot;
// transfers and jobs on other accounts remain independent.
func (s *Service) runDelete(id string, params map[string]any, items []map[string]any) {
	ctx := context.Background()
	stopped := func() bool {
		cancel, err := s.Store.IsCancelRequested(ctx, id)
		if cancel {
			_ = s.Store.Finish(ctx, id, jobs.StatusCanceled, "")
		}
		return cancel || err != nil
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
waiting:
	for {
		if stopped() {
			return
		}
		select {
		case s.deleteSlot <- struct{}{}:
			break waiting
		case <-ticker.C:
		}
	}
	defer func() { <-s.deleteSlot }()
	if stopped() {
		return
	}
	_ = s.Store.MarkRunning(ctx, id)
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item["id"].(string))
	}
	args := transferArgs(params, map[string]any{"ids": ids})
	_, err := s.Provider.Call(ctx, "delete", args, func(p jobs.TransferProgress) error {
		return s.Store.ReportTransfer(ctx, id, p)
	})
	if errors.Is(err, context.Canceled) {
		_ = s.Store.Finish(ctx, id, jobs.StatusCanceled, "")
		return
	}
	// The provider reports acceptance, not completion of the remote recycle-bin
	// operation. Do not issue further mutations to probe whether it has finished.
	for range items {
		_ = s.Store.RecordProgress(ctx, id, err)
	}
	status := jobs.StatusCompleted
	if err != nil {
		status = jobs.StatusCompletedWithErrors
	} else {
		_ = s.Store.ReportTransfer(ctx, id, jobs.TransferProgress{Phase: "waiting", Warning: "删除请求已提交到115，云端可能仍在处理，请刷新后确认"})
	}
	_ = s.Store.Finish(ctx, id, status, "")
}
