//go:build aix || android || darwin || dragonfly || freebsd || illumos || ios || linux || netbsd || openbsd || solaris

package links

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestPlannerRejectsSpecialEntryInsideDirectoryClone(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	special := filepath.Join(sourceRoot, "set", "album", "pipe")
	if err := os.MkdirAll(filepath.Dir(special), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(special, 0o600); err != nil {
		t.Fatal(err)
	}

	plan, err := testPlanner(sourceRoot, destRoot).Plan(context.Background(), Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: ".",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !plan.Preview.HasConflict || plan.Preview.Items[0].ErrorCode != ErrorSpecialEntry {
		t.Fatalf("plan = %+v", plan.Preview)
	}
}
