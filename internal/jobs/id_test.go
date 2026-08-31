package jobs

import (
	"regexp"
	"testing"
)

func TestNewIDReturnsDistinctOpaqueJobIDs(t *testing.T) {
	seen := make(map[string]struct{})
	pattern := regexp.MustCompile(`^job_[0-9a-f]{32}$`)
	for range 100 {
		id := NewID()
		if !pattern.MatchString(id) {
			t.Fatalf("id = %q", id)
		}
		if _, duplicate := seen[id]; duplicate {
			t.Fatalf("duplicate id = %q", id)
		}
		seen[id] = struct{}{}
	}
}
