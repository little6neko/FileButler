package superrename

import "testing"

func TestClassifyMedia(t *testing.T) {
	tests := []struct {
		name      string
		wantKind  MediaKind
		wantExt   string
		wantMatch bool
	}{
		{name: "photo.JPG", wantKind: MediaKindImage, wantExt: ".JPG", wantMatch: true},
		{name: "clip.MkV", wantKind: MediaKindVideo, wantExt: ".MkV", wantMatch: true},
		{name: "archive.tar.webp", wantKind: MediaKindImage, wantExt: ".webp", wantMatch: true},
		{name: "notes.txt", wantExt: ".txt"},
		{name: "README"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			kind, extension, matched := ClassifyMedia(test.name)
			if kind != test.wantKind || extension != test.wantExt || matched != test.wantMatch {
				t.Fatalf("ClassifyMedia(%q) = (%q, %q, %t), want (%q, %q, %t)", test.name, kind, extension, matched, test.wantKind, test.wantExt, test.wantMatch)
			}
		})
	}
}

func TestSequencePadding(t *testing.T) {
	tests := []struct {
		count int
		want  int
	}{
		{count: 0, want: 2},
		{count: 99, want: 2},
		{count: 100, want: 3},
		{count: 9999, want: 4},
		{count: 10000, want: 5},
	}
	for _, test := range tests {
		if got := SequencePadding(test.count); got != test.want {
			t.Fatalf("SequencePadding(%d) = %d, want %d", test.count, got, test.want)
		}
	}
}
