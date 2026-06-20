package store

import (
	"context"
	"database/sql"
	"fmt"
)

type migration struct {
	Version int
	SQL     string
}

var migrations = []migration{
	{Version: 1, SQL: `
create table if not exists schema_migrations (
  version integer primary key,
  applied_at text not null default current_timestamp
);
create table if not exists users (
  id integer primary key autoincrement,
  username text not null unique,
  password_hash text not null,
  created_at text not null default current_timestamp
);
create table if not exists sessions (
  id text primary key,
  user_id integer not null references users(id) on delete cascade,
  expires_at text not null,
  created_at text not null default current_timestamp
);
create table if not exists jobs (
  id text primary key,
  type text not null,
  status text not null,
  actor_id integer not null references users(id),
  source_root_id text not null,
  dest_root_id text,
  plan_json text not null,
  root_snapshot_json text not null,
  progress_total integer not null default 0,
  progress_done integer not null default 0,
  cancel_requested integer not null default 0,
  error_message text not null default '',
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  finished_at text
);
create table if not exists job_items (
  job_id text not null references jobs(id) on delete cascade,
  item_index integer not null,
  source_path text not null,
  dest_path text,
  status text not null,
  error_code text not null default '',
  error_message text not null default '',
  undo_json text not null default '{}',
  primary key (job_id, item_index)
);
create table if not exists audit_records (
  id integer primary key autoincrement,
  actor_id integer not null references users(id),
  action text not null,
  source_root_id text not null,
  source_path text not null,
  dest_root_id text,
  dest_path text,
  job_id text,
  detail_json text not null default '{}',
  created_at text not null default current_timestamp
);
`},
}

func ApplyMigrations(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `create table if not exists schema_migrations (version integer primary key, applied_at text not null default current_timestamp)`); err != nil {
		return err
	}
	for _, m := range migrations {
		var exists int
		err := db.QueryRowContext(ctx, `select count(1) from schema_migrations where version = ?`, m.Version).Scan(&exists)
		if err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, m.SQL); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %d: %w", m.Version, err)
		}
		if _, err := tx.ExecContext(ctx, `insert into schema_migrations(version) values (?)`, m.Version); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
