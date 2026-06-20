package natsort

import (
	"sort"
	"testing"
)

func TestLessUsesWindowsExplorerStyleNumberComparison(t *testing.T) {
	names := []string{"file100", "file10", "file02", "file2", "file1"}
	sort.SliceStable(names, func(i, j int) bool { return Less(names[i], names[j]) })
	want := []string{"file1", "file2", "file02", "file10", "file100"}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("sorted[%d] = %q, want %q; all=%v", i, names[i], want[i], names)
		}
	}
}

func TestLessIsCaseInsensitiveWithStableTieBreaker(t *testing.T) {
	names := []string{"beta", "Alpha", "alpha2", "alpha10"}
	sort.SliceStable(names, func(i, j int) bool { return Less(names[i], names[j]) })
	want := []string{"Alpha", "alpha2", "alpha10", "beta"}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("sorted[%d] = %q, want %q; all=%v", i, names[i], want[i], names)
		}
	}
}
