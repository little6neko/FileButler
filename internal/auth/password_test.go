package auth

import "testing"

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if hash == "correct horse battery staple" {
		t.Fatal("hash stored plaintext password")
	}
	if !VerifyPassword(hash, "correct horse battery staple") {
		t.Fatal("VerifyPassword rejected correct password")
	}
	if VerifyPassword(hash, "wrong password") {
		t.Fatal("VerifyPassword accepted wrong password")
	}
	if !ValidPasswordHash(hash) {
		t.Fatal("ValidPasswordHash rejected a generated hash")
	}
	if ValidPasswordHash("$argon2id$v=19$m=1,t=1,p=1$YQ$Yg") {
		t.Fatal("ValidPasswordHash accepted unsupported parameters")
	}
}
