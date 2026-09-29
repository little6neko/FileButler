package ops

import (
	"context"
	"io/fs"
	"path/filepath"

	"github.com/little6neko/filebutler/internal/jobs"
)

func (e JobExecutor) ScanTransfer(ctx context.Context, item jobs.ExecutableItem, moved bool) (jobs.TransferTotals, error) {
	if moved {
		item.SourceRoot, item.SourcePath = item.DestRoot, item.DestPath
	}
	source, err := resolveOperationSource(e.Executor.Resolver, item.SourceRoot, item.SourcePath)
	if err == nil {
		return scanTransferTree(ctx, source.Actual.Abs)
	}
	return jobs.TransferTotals{}, err
}

func scanTransferTree(ctx context.Context, path string) (jobs.TransferTotals, error) {
	var total jobs.TransferTotals
	err := filepath.WalkDir(path, func(_ string, entry fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total.Files++
		if info.Mode().IsRegular() {
			total.Bytes += info.Size()
		}
		return nil
	})
	return total, err
}
