package jobs

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

const jobColumns = `
id, type, status, actor_id, source_root_id, dest_root_id, plan_json, root_snapshot_json,
progress_total, progress_done, cancel_requested, error_message,
strftime('%s', created_at), strftime('%s', updated_at), finished_at, event_version`

type Store struct {
	DB        *sql.DB
	Publisher Publisher
}

type Snapshot struct {
	Cursor int64 `json:"cursor"`
	Jobs   []Job `json:"jobs"`
}

func (s Store) Create(ctx context.Context, job Job) error {
	if job.Status == "" {
		job.Status = StatusPending
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	version, err := nextEventVersion(ctx, tx)
	if err != nil {
		return err
	}
	cancelRequested := 0
	if job.CancelRequested {
		cancelRequested = 1
	}
	if _, err := tx.ExecContext(ctx, `
insert into jobs(
  id, type, status, actor_id, source_root_id, dest_root_id, plan_json, root_snapshot_json,
  progress_total, progress_done, cancel_requested, error_message, event_version
)
values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.Type, job.Status, job.ActorID, job.SourceRootID, nullEmpty(job.DestRootID),
		job.PlanJSON, job.RootSnapshotJSON, job.ProgressTotal, job.ProgressDone, cancelRequested,
		job.ErrorMessage, version); err != nil {
		return err
	}
	created, err := loadJob(ctx, tx, job.ID)
	if err != nil {
		return err
	}
	return s.commitAndPublish(tx, Event{Job: created})
}

func (s Store) Get(ctx context.Context, id string) (Job, []ItemResult, error) {
	job, err := loadJob(ctx, s.DB, id)
	if err != nil {
		return Job{}, nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `
select job_id, item_index, source_path, dest_path, status, error_code, error_message, undo_json
from job_items where job_id = ? order by item_index`, id)
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
	rows, err := s.DB.QueryContext(ctx, `select `+jobColumns+` from jobs order by rowid desc limit ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJobs(rows)
}

func (s Store) CurrentEventVersion(ctx context.Context) (int64, error) {
	var version int64
	err := s.DB.QueryRowContext(ctx, `select version from job_event_clock where id = 1`).Scan(&version)
	return version, err
}

// Snapshot returns a consistent job view and the event watermark represented by
// that view. A valid cursor also includes terminal jobs beyond the normal list
// limit when they changed while the client was disconnected.
func (s Store) Snapshot(ctx context.Context, afterVersion *int64, terminalLimit int) (Snapshot, error) {
	if terminalLimit <= 0 {
		terminalLimit = 50
	}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback()

	var watermark int64
	if err := tx.QueryRowContext(ctx, `select version from job_event_clock where id = 1`).Scan(&watermark); err != nil {
		return Snapshot{}, err
	}
	includeChanged := 0
	after := int64(0)
	if afterVersion != nil && *afterVersion >= 0 && *afterVersion <= watermark {
		includeChanged = 1
		after = *afterVersion
	}
	terminal := []any{StatusCompleted, StatusCompletedWithErrors, StatusFailed, StatusCanceled}
	args := append([]any{}, terminal...)
	args = append(args, terminal...)
	args = append(args, terminalLimit, includeChanged, after)
	rows, err := tx.QueryContext(ctx, `
select `+jobColumns+` from jobs
where status not in (?, ?, ?, ?)
   or id in (
     select id from jobs where status in (?, ?, ?, ?) order by rowid desc limit ?
   )
   or (? = 1 and event_version > ?)
order by rowid desc`, args...)
	if err != nil {
		return Snapshot{}, err
	}
	jobs, err := scanJobs(rows)
	if err != nil {
		return Snapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return Snapshot{}, err
	}
	return Snapshot{Cursor: watermark, Jobs: jobs}, nil
}

func (s Store) MarkRunning(ctx context.Context, id string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	status, err := loadStatus(ctx, tx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if status != StatusPending {
		return nil
	}
	version, err := nextEventVersion(ctx, tx)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
update jobs set status = ?, updated_at = current_timestamp, event_version = ?
where id = ? and status = ?`, StatusRunning, version, id, StatusPending)
	if err != nil {
		return err
	}
	changed, err := rowChanged(result)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	job, err := loadJob(ctx, tx, id)
	if err != nil {
		return err
	}
	return s.commitAndPublish(tx, Event{Job: job})
}

// RecordItemResult atomically appends the item result and advances job progress.
func (s Store) RecordItemResult(ctx context.Context, result ItemResult) error {
	if result.UndoJSON == "" {
		result.UndoJSON = "{}"
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	status, err := loadStatus(ctx, tx, result.JobID)
	if err != nil {
		return err
	}
	if status.IsTerminal() {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `
insert into job_items(job_id, item_index, source_path, dest_path, status, error_code, error_message, undo_json)
values (?, ?, ?, ?, ?, ?, ?, ?)`,
		result.JobID, result.Index, result.SourcePath, nullEmpty(result.DestPath), result.Status,
		result.ErrorCode, result.ErrorMessage, result.UndoJSON); err != nil {
		return err
	}
	version, err := nextEventVersion(ctx, tx)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
update jobs
set progress_done = progress_done + 1, updated_at = current_timestamp, event_version = ?
where id = ?`, version, result.JobID); err != nil {
		return err
	}
	job, err := loadJob(ctx, tx, result.JobID)
	if err != nil {
		return err
	}
	return s.commitAndPublish(tx, Event{Job: job, Item: &result})
}

func (s Store) RequestCancel(ctx context.Context, id string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	status, err := loadStatus(ctx, tx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if status != StatusPending && status != StatusRunning {
		return nil
	}
	version, err := nextEventVersion(ctx, tx)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
update jobs
set cancel_requested = 1, status = ?, updated_at = current_timestamp, event_version = ?
where id = ? and status in (?, ?)`,
		StatusCancelRequested, version, id, StatusPending, StatusRunning)
	if err != nil {
		return err
	}
	changed, err := rowChanged(result)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	job, err := loadJob(ctx, tx, id)
	if err != nil {
		return err
	}
	return s.commitAndPublish(tx, Event{Job: job})
}

func (s Store) IsCancelRequested(ctx context.Context, id string) (bool, error) {
	var cancel int
	err := s.DB.QueryRowContext(ctx, `select cancel_requested from jobs where id = ?`, id).Scan(&cancel)
	return cancel != 0, err
}

func (s Store) Finish(ctx context.Context, id string, status Status, message string) error {
	if !status.IsTerminal() {
		return errors.New("finish status must be terminal")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	current, err := loadStatus(ctx, tx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if current.IsTerminal() {
		return nil
	}
	version, err := nextEventVersion(ctx, tx)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
update jobs
set status = ?, error_message = ?, updated_at = current_timestamp, finished_at = ?, event_version = ?
where id = ? and status not in (?, ?, ?, ?)`,
		status, message, time.Now().UTC().Format(time.RFC3339Nano), version, id,
		StatusCompleted, StatusCompletedWithErrors, StatusFailed, StatusCanceled)
	if err != nil {
		return err
	}
	changed, err := rowChanged(result)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	job, err := loadJob(ctx, tx, id)
	if err != nil {
		return err
	}
	return s.commitAndPublish(tx, Event{Job: job})
}

func (s Store) commitAndPublish(tx *sql.Tx, event Event) error {
	if err := tx.Commit(); err != nil {
		return err
	}
	if s.Publisher != nil {
		s.Publisher.Publish(event)
	}
	return nil
}

func nextEventVersion(ctx context.Context, tx *sql.Tx) (int64, error) {
	if _, err := tx.ExecContext(ctx, `update job_event_clock set version = version + 1 where id = 1`); err != nil {
		return 0, err
	}
	var version int64
	err := tx.QueryRowContext(ctx, `select version from job_event_clock where id = 1`).Scan(&version)
	return version, err
}

func rowChanged(result sql.Result) (bool, error) {
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func loadStatus(ctx context.Context, tx *sql.Tx, id string) (Status, error) {
	var status Status
	err := tx.QueryRowContext(ctx, `select status from jobs where id = ?`, id).Scan(&status)
	return status, err
}

type rowQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type rowScanner interface {
	Scan(...any) error
}

func loadJob(ctx context.Context, queryer rowQueryer, id string) (Job, error) {
	return scanJob(queryer.QueryRowContext(ctx, `select `+jobColumns+` from jobs where id = ?`, id))
}

func scanJob(scanner rowScanner) (Job, error) {
	var job Job
	var dest sql.NullString
	var finished sql.NullString
	var cancel int
	err := scanner.Scan(
		&job.ID, &job.Type, &job.Status, &job.ActorID, &job.SourceRootID, &dest,
		&job.PlanJSON, &job.RootSnapshotJSON, &job.ProgressTotal, &job.ProgressDone,
		&cancel, &job.ErrorMessage, &job.CreatedAtUnix, &job.UpdatedAtUnix, &finished,
		&job.EventVersion,
	)
	if err != nil {
		return Job{}, err
	}
	job.DestRootID = dest.String
	job.CancelRequested = cancel != 0
	if finished.Valid {
		if ts, err := time.Parse(time.RFC3339Nano, finished.String); err == nil {
			job.FinishedAtUnix = ts.Unix()
		}
	}
	return job, nil
}

func scanJobs(rows *sql.Rows) ([]Job, error) {
	defer rows.Close()
	jobs := make([]Job, 0)
	for rows.Next() {
		job, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func nullEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}
