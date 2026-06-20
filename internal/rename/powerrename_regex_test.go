package rename

import "testing"

func TestPowerRenameRegexReplacesFirstByDefault(t *testing.T) {
	got, matched, err := powerRenameRegexReplace("file-file.txt", "file", "doc", PowerRenameRegexOptions{MatchAll: false, CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if !matched || got != "doc-file.txt" {
		t.Fatalf("got=%q matched=%v", got, matched)
	}
}

func TestPowerRenameRegexReplacesAllWhenEnabled(t *testing.T) {
	got, matched, err := powerRenameRegexReplace("file-file.txt", "file", "doc", PowerRenameRegexOptions{MatchAll: true, CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if !matched || got != "doc-doc.txt" {
		t.Fatalf("got=%q matched=%v", got, matched)
	}
}

func TestPowerRenameRegexIsCaseInsensitiveByDefault(t *testing.T) {
	got, matched, err := powerRenameRegexReplace("File.txt", "file", "doc", PowerRenameRegexOptions{MatchAll: false, CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if !matched || got != "doc.txt" {
		t.Fatalf("got=%q matched=%v", got, matched)
	}
}

func TestPowerRenameRegexSupportsECMAScriptLookahead(t *testing.T) {
	got, matched, err := powerRenameRegexReplace("file12.txt", `file(?=\d+)`, "doc", PowerRenameRegexOptions{MatchAll: false, CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if !matched || got != "doc12.txt" {
		t.Fatalf("got=%q matched=%v", got, matched)
	}
}

func TestPowerRenameRegexReplacementGroups(t *testing.T) {
	got, matched, err := powerRenameRegexReplace("file12.txt", `file(\d+)`, "doc$1-$0", PowerRenameRegexOptions{MatchAll: false, CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if !matched || got != "doc12-file12.txt" {
		t.Fatalf("got=%q matched=%v", got, matched)
	}
}
