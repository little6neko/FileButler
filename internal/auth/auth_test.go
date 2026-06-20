package auth

import (
	"context"
	"testing"
	"time"

	"github.com/little6neko/filebutler/internal/testutil"
)

func TestInitStatusAndCreateAdmin(t *testing.T) {
	db := testutil.OpenTestDB(t)
	svc := Service{DB: db, SessionMaxAge: time.Hour}
	ctx := context.Background()

	needs, err := svc.NeedsInitialization(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !needs {
		t.Fatal("expected fresh database to need initialization")
	}

	user, err := svc.CreateAdmin(ctx, " admin ", "long-password")
	if err != nil {
		t.Fatalf("CreateAdmin: %v", err)
	}
	if user.Username != "admin" || user.ID == 0 {
		t.Fatalf("unexpected user: %+v", user)
	}
	needs, err = svc.NeedsInitialization(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if needs {
		t.Fatal("expected initialization to be closed")
	}
}

func TestCreateAdminOnlyOnce(t *testing.T) {
	db := testutil.OpenTestDB(t)
	svc := Service{DB: db, SessionMaxAge: time.Hour}
	ctx := context.Background()

	if _, err := svc.CreateAdmin(ctx, "admin", "long-password"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateAdmin(ctx, "other", "long-password"); err == nil {
		t.Fatal("expected second admin creation to fail")
	}
}

func TestLoginCreatesSession(t *testing.T) {
	db := testutil.OpenTestDB(t)
	svc := Service{DB: db, SessionMaxAge: time.Hour}
	ctx := context.Background()

	if _, err := svc.CreateAdmin(ctx, "admin", "long-password"); err != nil {
		t.Fatal(err)
	}
	sessionID, user, err := svc.Login(ctx, "admin", "long-password")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if sessionID == "" || user.Username != "admin" {
		t.Fatalf("unexpected login result: session=%q user=%+v", sessionID, user)
	}
	got, err := svc.LookupSession(ctx, sessionID)
	if err != nil {
		t.Fatalf("LookupSession: %v", err)
	}
	if got.ID != user.ID {
		t.Fatalf("session user id = %d, want %d", got.ID, user.ID)
	}
}

func TestSessionLookupRejectsExpiredSession(t *testing.T) {
	db := testutil.OpenTestDB(t)
	svc := Service{DB: db, SessionMaxAge: -time.Hour}
	ctx := context.Background()

	if _, err := svc.CreateAdmin(ctx, "admin", "long-password"); err != nil {
		t.Fatal(err)
	}
	sessionID, _, err := svc.Login(ctx, "admin", "long-password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.LookupSession(ctx, sessionID); err == nil {
		t.Fatal("expected expired session to be rejected")
	}
	var count int
	if err := db.QueryRowContext(ctx, `select count(1) from sessions where id = ?`, sessionID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("expected expired session to be deleted")
	}
}
