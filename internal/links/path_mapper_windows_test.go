//go:build windows

package links

import "testing"

func TestRelativeLinkTargetFallsBackToAbsoluteAcrossWindowsVolumes(t *testing.T) {
	target := `D:\source\file.txt`
	if got := RelativeLinkTarget(`C:\destination`, target); got != target {
		t.Fatalf("target = %q, want %q", got, target)
	}
}
