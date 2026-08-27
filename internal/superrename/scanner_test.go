package superrename

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestScannerBuildsNaturallySortedNonRecursiveInventory(t *testing.T) {
	root := t.TempDir()
	current := filepath.Join(root, "albums")
	testutil.WriteFile(t, filepath.Join(current, "ignored.jpg"), "root file")
	testutil.WriteFile(t, filepath.Join(current, "group10", "image10.JPG"), "x")
	testutil.WriteFile(t, filepath.Join(current, "group2", "image10.webp"), "x")
	testutil.WriteFile(t, filepath.Join(current, "group2", "image2.PNG"), "x")
	testutil.WriteFile(t, filepath.Join(current, "group2", "clip10.webm"), "x")
	testutil.WriteFile(t, filepath.Join(current, "group2", "clip2.MP4"), "x")
	testutil.WriteFile(t, filepath.Join(current, "group2", "notes.txt"), "x")
	testutil.WriteFile(t, filepath.Join(current, "group2", "nested", "nested.jpg"), "x")
	testutil.WriteFile(t, filepath.Join(current, "group2", "视频", "V01.mp4"), "existing")
	if err := os.Symlink("image2.PNG", filepath.Join(current, "group2", "linked.jpg")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(current, "group1"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("group2", filepath.Join(current, "linked-group")); err != nil {
		t.Fatal(err)
	}

	scanner := Scanner{
		Resolver: roots.NewResolver([]roots.Root{{ID: "media", Name: "Media", Path: root}}),
		Now:      func() time.Time { return time.Unix(1_234, 0) },
	}
	inventory, err := scanner.Scan(context.Background(), "media", "albums")
	if err != nil {
		t.Fatal(err)
	}

	if inventory.RootID != "media" || inventory.DirectoryPath != "albums" || inventory.GeneratedAtUnix != 1_234 {
		t.Fatalf("inventory metadata = %+v", inventory)
	}
	if got := groupNames(inventory.Groups); !reflect.DeepEqual(got, []string{"group1", "group2", "group10"}) {
		t.Fatalf("groups = %v", got)
	}
	group := inventory.Groups[1]
	if got := candidateNames(group.Images); !reflect.DeepEqual(got, []string{"image2.PNG", "image10.webp"}) {
		t.Fatalf("images = %v", got)
	}
	if got := candidateNames(group.Videos); !reflect.DeepEqual(got, []string{"clip2.MP4", "clip10.webm"}) {
		t.Fatalf("videos = %v", got)
	}
	if got := unmatchedNames(group.Unmatched); !reflect.DeepEqual(got, []string{"linked.jpg", "nested", "notes.txt"}) {
		t.Fatalf("unmatched = %v", got)
	}
	if group.Unmatched[1].Reason != UnmatchedNestedDirectory {
		t.Fatalf("nested reason = %q", group.Unmatched[1].Reason)
	}
	if group.VideoDirectory.Status != VideoDirectoryPresent || group.VideoDirectory.Path != "albums/group2/视频" {
		t.Fatalf("video directory = %+v", group.VideoDirectory)
	}
	if !reflect.DeepEqual(group.VideoDirectory.OccupiedPaths, []string{"albums/group2/视频/V01.mp4"}) {
		t.Fatalf("video occupied = %v", group.VideoDirectory.OccupiedPaths)
	}
	if len(inventory.Groups[0].Images) != 0 || len(inventory.Groups[0].Videos) != 0 {
		t.Fatalf("empty group unexpectedly matched: %+v", inventory.Groups[0])
	}
}

func TestScannerMarksBlockingVideoEntryAndRecoveryResidue(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "set", "A", "clip.mp4"), "x")
	testutil.WriteFile(t, filepath.Join(root, "set", "A", "视频"), "blocking")
	if err := os.MkdirAll(filepath.Join(root, "set", "A", ".filebutler-superrename-job-1"), 0o755); err != nil {
		t.Fatal(err)
	}

	scanner := Scanner{Resolver: roots.NewResolver([]roots.Root{{ID: "media", Path: root}})}
	inventory, err := scanner.Scan(context.Background(), "media", "set")
	if err != nil {
		t.Fatal(err)
	}
	group := inventory.Groups[0]
	if group.VideoDirectory.Status != VideoDirectoryBlockingEntry {
		t.Fatalf("video status = %q", group.VideoDirectory.Status)
	}
	if !reflect.DeepEqual(group.RecoveryResidues, []string{"set/A/.filebutler-superrename-job-1"}) {
		t.Fatalf("residues = %v", group.RecoveryResidues)
	}
	if got := unmatchedNames(group.Unmatched); !reflect.DeepEqual(got, []string{".filebutler-superrename-job-1", "视频"}) {
		t.Fatalf("unmatched = %v", got)
	}
}

func TestScannerRejectsFileOutsideRootAndDirectorySymlink(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "file.txt"), "x")
	if err := os.Mkdir(filepath.Join(root, "target"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("target", filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	scanner := Scanner{Resolver: roots.NewResolver([]roots.Root{{ID: "media", Path: root}})}

	if _, err := scanner.Scan(context.Background(), "media", "file.txt"); !errors.Is(err, ErrNotDirectory) {
		t.Fatalf("file error = %v, want ErrNotDirectory", err)
	}
	if _, err := scanner.Scan(context.Background(), "media", "link"); !errors.Is(err, ErrNotDirectory) {
		t.Fatalf("symlink error = %v, want ErrNotDirectory", err)
	}
	if _, err := scanner.Scan(context.Background(), "media", "../outside"); !errors.Is(err, roots.ErrOutsideRoot) {
		t.Fatalf("outside error = %v, want ErrOutsideRoot", err)
	}
}

func TestScannerHonorsCanceledContext(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "group"), 0o755); err != nil {
		t.Fatal(err)
	}
	scanner := Scanner{Resolver: roots.NewResolver([]roots.Root{{ID: "media", Path: root}})}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := scanner.Scan(ctx, "media", ".")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want canceled", err)
	}
}

func groupNames(groups []InventoryGroup) []string {
	names := make([]string, len(groups))
	for index, group := range groups {
		names[index] = group.Name
	}
	return names
}

func candidateNames(candidates []Candidate) []string {
	names := make([]string, len(candidates))
	for index, candidate := range candidates {
		names[index] = candidate.Name
	}
	return names
}

func unmatchedNames(items []Unmatched) []string {
	names := make([]string, len(items))
	for index, item := range items {
		names[index] = item.Name
	}
	return names
}
