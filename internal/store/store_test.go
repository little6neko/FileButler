package store

import (
	"context"
	"database/sql"
	"testing"
)

func TestOpenAppliesMigrations(t *testing.T) {
	db, err := Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer db.Close()

	rows, err := db.QueryContext(context.Background(), `select name from sqlite_master where type = 'table'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	tables := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables[name] = true
	}
	for _, name := range []string{"schema_migrations", "users", "sessions", "jobs", "job_items", "audit_records", "job_event_clock"} {
		if !tables[name] {
			t.Fatalf("missing table %s; tables=%v", name, tables)
		}
	}

	var eventVersionColumn int
	if err := db.QueryRowContext(context.Background(), `
select count(1) from pragma_table_info('jobs') where name = 'event_version'`).Scan(&eventVersionColumn); err != nil {
		t.Fatal(err)
	}
	if eventVersionColumn != 1 {
		t.Fatal("jobs.event_version migration was not applied")
	}

	var clock int64
	if err := db.QueryRowContext(context.Background(), `select version from job_event_clock where id = 1`).Scan(&clock); err != nil {
		t.Fatal(err)
	}
	if clock != 0 {
		t.Fatalf("initial event clock = %d, want 0", clock)
	}
}

func TestMigrationsAreIdempotent(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if err := ApplyMigrations(context.Background(), db); err != nil {
		t.Fatalf("first ApplyMigrations: %v", err)
	}
	if err := ApplyMigrations(context.Background(), db); err != nil {
		t.Fatalf("second ApplyMigrations: %v", err)
	}
}
