package links

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadIdentityTracksObjectsAndFilesystems(t *testing.T) {
	directory := t.TempDir()
	first := filepath.Join(directory, "first.txt")
	hardlink := filepath.Join(directory, "hardlink.txt")
	second := filepath.Join(directory, "second.txt")
	mustWrite(t, first, "first")
	mustWrite(t, second, "second")
	if err := os.Link(first, hardlink); err != nil {
		t.Fatal(err)
	}

	firstID := mustIdentity(t, first, false)
	hardlinkID := mustIdentity(t, hardlink, false)
	secondID := mustIdentity(t, second, false)
	directoryID := mustIdentity(t, directory, false)
	if !firstID.SameObject(hardlinkID) {
		t.Fatalf("hardlink identities differ: %+v %+v", firstID, hardlinkID)
	}
	if firstID.SameObject(secondID) {
		t.Fatalf("different files share identity: %+v %+v", firstID, secondID)
	}
	if !firstID.SameFilesystem(secondID) || !firstID.SameFilesystem(directoryID) {
		t.Fatalf("same directory reported different filesystems: %+v %+v %+v", firstID, secondID, directoryID)
	}

	mustWrite(t, first, "updated content")
	updatedID := mustIdentity(t, first, false)
	if !firstID.SameObject(updatedID) {
		t.Fatalf("content update changed object identity: %+v %+v", firstID, updatedID)
	}

	if err := os.Remove(first); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, first, "replacement")
	replacementID := mustIdentity(t, first, false)
	if firstID.SameObject(replacementID) {
		t.Fatalf("replacement retained object identity: %+v", replacementID)
	}
}

func TestReadIdentityCanFollowOrIdentifySymlinkEntry(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target.txt")
	link := filepath.Join(directory, "link.txt")
	mustWrite(t, target, "target")
	if err := os.Symlink("target.txt", link); err != nil {
		t.Fatal(err)
	}

	targetID := mustIdentity(t, target, false)
	linkID := mustIdentity(t, link, false)
	followedID := mustIdentity(t, link, true)
	if linkID.Kind != SourceSymlink || linkID.SameObject(targetID) {
		t.Fatalf("link entry identity = %+v, target = %+v", linkID, targetID)
	}
	if !followedID.SameObject(targetID) {
		t.Fatalf("followed identity = %+v, target = %+v", followedID, targetID)
	}
}

func mustIdentity(t *testing.T, path string, follow bool) FileIdentity {
	t.Helper()
	identity, err := ReadIdentity(path, follow)
	if err != nil {
		t.Fatalf("ReadIdentity(%q): %v", path, err)
	}
	return identity
}

func mustWrite(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
