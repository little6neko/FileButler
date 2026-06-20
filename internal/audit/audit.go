package audit

import (
	"context"
	"database/sql"
)

type Record struct {
	ActorID       int64  `json:"actorId"`
	Action        string `json:"action"`
	SourceRootID  string `json:"sourceRootId"`
	SourcePath    string `json:"sourcePath"`
	DestRootID    string `json:"destRootId,omitempty"`
	DestPath      string `json:"destPath,omitempty"`
	JobID         string `json:"jobId,omitempty"`
	DetailJSON    string `json:"detailJson"`
	CreatedAtUnix int64  `json:"createdAtUnix,omitempty"`
}

type Store struct {
	DB *sql.DB
}

func (s Store) Insert(ctx context.Context, record Record) error {
	if record.DetailJSON == "" {
		record.DetailJSON = "{}"
	}
	_, err := s.DB.ExecContext(ctx, `
insert into audit_records(actor_id, action, source_root_id, source_path, dest_root_id, dest_path, job_id, detail_json)
values (?, ?, ?, ?, ?, ?, ?, ?)`,
		record.ActorID, record.Action, record.SourceRootID, record.SourcePath, nullEmpty(record.DestRootID), nullEmpty(record.DestPath), nullEmpty(record.JobID), record.DetailJSON)
	return err
}

func (s Store) List(ctx context.Context, limit int) ([]Record, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.DB.QueryContext(ctx, `
select actor_id, action, source_root_id, source_path, coalesce(dest_root_id, ''), coalesce(dest_path, ''), coalesce(job_id, ''), detail_json, strftime('%s', created_at)
from audit_records order by id desc limit ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Record
	for rows.Next() {
		var record Record
		if err := rows.Scan(&record.ActorID, &record.Action, &record.SourceRootID, &record.SourcePath, &record.DestRootID, &record.DestPath, &record.JobID, &record.DetailJSON, &record.CreatedAtUnix); err != nil {
			return nil, err
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

func nullEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}
