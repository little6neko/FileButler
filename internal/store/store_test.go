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
	for _, name := range []string{"schema_migrations", "users", "sessions", "jobs", "job_items", "audit_records"} {
		if !tables[name] {
			t.Fatalf("missing table %s; tables=%v", name, tables)
		}
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
