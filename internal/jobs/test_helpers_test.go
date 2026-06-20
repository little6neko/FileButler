package jobs

import (
	"context"
	"database/sql"
	"testing"
)

func insertActor(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	res, err := db.ExecContext(context.Background(), `insert into users(username, password_hash) values (?, ?)`, "admin"+t.Name(), "hash")
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}
