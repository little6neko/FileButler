package cloud115

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/little6neko/filebutler/internal/jobs"
)

func transferArgs(params, item map[string]any) map[string]any {
	args := make(map[string]any, len(params)+len(item))
	for k, v := range params {
		args[k] = v
	}
	for k, v := range item {
		args[k] = v
	}
	return args
}

func isBatchTransfer(method string, args map[string]any) bool {
	if method == "download" || method == "upload" || method == "copy" {
		return true
	}
	if method != "ops.execute" {
		return false
	}
	operation := args["type"]
	return (operation == "copy" || operation == "move") && !(operation == "move" && args["sourceCloud"] == true && args["targetCloud"] == true)
}

func (s *Service) transferBatch(ctx context.Context, id, method string, params map[string]any, items []map[string]any) *jobs.TransferBatch {
	if len(items) == 0 || !isBatchTransfer(method, transferArgs(params, items[0])) {
		return nil
	}
	return jobs.NewTransferBatch(ctx, len(items), func(p jobs.TransferProgress) error { return s.Store.ReportTransfer(ctx, id, p) }, func(ctx context.Context, i int, _ bool) (jobs.TransferTotals, error) {
		args := transferArgs(params, items[i])
		args["transferMethod"] = method
		data, err := s.Provider.Call(ctx, "transfer.statistics", args, func(jobs.TransferProgress) error { return ctx.Err() })
		if err != nil {
			return jobs.TransferTotals{}, err
		}
		var total struct {
			Bytes *int64 `json:"bytes"`
			Files *int   `json:"files"`
		}
		if err := json.Unmarshal(data, &total); err != nil {
			return jobs.TransferTotals{}, err
		}
		if total.Bytes == nil || total.Files == nil || *total.Bytes < 0 || *total.Files < 0 {
			return jobs.TransferTotals{}, fmt.Errorf("115返回了无效的传输统计")
		}
		return jobs.TransferTotals{Bytes: *total.Bytes, Files: *total.Files}, nil
	})
}
