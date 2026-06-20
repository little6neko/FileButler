package jobs

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type Store struct {
	DB *sql.DB
}

func (s Store) Create(ctx context.Context, job Job) error {
	if job.Status == "" {
		job.Status = StatusPending
	}
	_, err := s.DB.ExecContext(ctx, `
insert into jobs(id, type, status, actor_id, source_root_id, dest_root_id, plan_json, root_snapshot_json, progress_total, progress_done, error_message)
values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.Type, job.Status, job.ActorID, job.SourceRootID, nullEmpty(job.DestRootID), job.PlanJSON, job.RootSnapshotJSON, job.ProgressTotal, job.ProgressDone, job.ErrorMessage)
	return err
}

func (s Store) Get(ctx context.Context, id string) (Job, []ItemResult, error) {
	var job Job
	var dest sql.NullString
	var finished sql.NullString
	var cancel int
	err := s.DB.QueryRowContext(ctx, `
select id, type, status, actor_id, source_root_id, dest_root_id, plan_json, root_snapshot_json,
progress_total, progress_done, cancel_requested, error_message,
strftime('%s', created_at), strftime('%s', updated_at), finished_at
from jobs where id = ?`, id).Scan(
		&job.ID, &job.Type, &job.Status, &job.ActorID, &job.SourceRootID, &dest, &job.PlanJSON, &job.RootSnapshotJSON,
		&job.ProgressTotal, &job.ProgressDone, &cancel, &job.ErrorMessage,
		&job.CreatedAtUnix, &job.UpdatedAtUnix, &finished)
	if err != nil {
		return Job{}, nil, err
	}
	job.DestRootID = dest.String
	job.CancelRequested = cancel != 0
	if finished.Valid {
		if ts, err := time.Parse(time.RFC3339Nano, finished.String); err == nil {
			job.FinishedAtUnix = ts.Unix()
		}
	}
	rows, err := s.DB.QueryContext(ctx, `select job_id, item_index, source_path, dest_path, status, error_code, error_message, undo_json from job_items where job_id = ? order by item_index`, id)
	if err != nil {
		return Job{}, nil, err
	}
	defer rows.Close()
	var items []ItemResult
	for rows.Next() {
		var item ItemResult
		var destPath sql.NullString
		if err := rows.Scan(&item.JobID, &item.Index, &item.SourcePath, &destPath, &item.Status, &item.ErrorCode, &item.ErrorMessage, &item.UndoJSON); err != nil {
			return Job{}, nil, err
		}
		item.DestPath = destPath.String
		items = append(items, item)
	}
	return job, items, rows.Err()
}

func (s Store) List(ctx context.Context, limit int) ([]Job, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.DB.QueryContext(ctx, `
select id, type, status, actor_id, source_root_id, coalesce(dest_root_id, ''), progress_total, progress_done, cancel_requested, error_message,
strftime('%s', created_at), strftime('%s', updated_at)
from jobs order by rowid desc limit ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Job
	for rows.Next() {
		var job Job
		var cancel int
		if err := rows.Scan(&job.ID, &job.Type, &job.Status, &job.ActorID, &job.SourceRootID, &job.DestRootID, &job.ProgressTotal, &job.ProgressDone, &cancel, &job.ErrorMessage, &job.CreatedAtUnix, &job.UpdatedAtUnix); err != nil {
			return nil, err
		}
		job.CancelRequested = cancel != 0
		out = append(out, job)
	}
	return out, rows.Err()
}

func (s Store) MarkRunning(ctx context.Context, id string) error {
	_, err := s.DB.ExecContext(ctx, `update jobs set status = ?, updated_at = current_timestamp where id = ?`, StatusRunning, id)
	return err
}

func (s Store) AddItemResult(ctx context.Context, result ItemResult) error {
	if result.UndoJSON == "" {
		result.UndoJSON = "{}"
	}
	_, err := s.DB.ExecContext(ctx, `
insert into job_items(job_id, item_index, source_path, dest_path, status, error_code, error_message, undo_json)
values (?, ?, ?, ?, ?, ?, ?, ?)`,
		result.JobID, result.Index, result.SourcePath, nullEmpty(result.DestPath), result.Status, result.ErrorCode, result.ErrorMessage, result.UndoJSON)
	return err
}

func (s Store) IncrementProgress(ctx context.Context, id string) error {
	_, err := s.DB.ExecContext(ctx, `update jobs set progress_done = progress_done + 1, updated_at = current_timestamp where id = ?`, id)
	return err
}

func (s Store) RequestCancel(ctx context.Context, id string) error {
	_, err := s.DB.ExecContext(ctx, `update jobs set cancel_requested = 1, status = ?, updated_at = current_timestamp where id = ?`, StatusCancelRequested, id)
	return err
}

func (s Store) IsCancelRequested(ctx context.Context, id string) (bool, error) {
	var cancel int
	err := s.DB.QueryRowContext(ctx, `select cancel_requested from jobs where id = ?`, id).Scan(&cancel)
	if errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	return cancel != 0, err
}

func (s Store) Finish(ctx context.Context, id string, status Status, message string) error {
	_, err := s.DB.ExecContext(ctx, `update jobs set status = ?, error_message = ?, updated_at = current_timestamp, finished_at = ? where id = ?`, status, message, time.Now().UTC().Format(time.RFC3339Nano), id)
	return err
}

func nullEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}
