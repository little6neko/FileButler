package testutil

import (
	"context"
	"database/sql"
	"testing"

	"github.com/little6neko/filebutler/internal/store"
)

func OpenTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}
