package links

import (
	"path/filepath"
	"testing"
)

func TestPathMapperRemapsOnlyCurrentTopLevelTree(t *testing.T) {
	base := filepath.Join(string(filepath.Separator), "srv", "数据")
	source := filepath.Join(base, "来源(一)")
	destination := filepath.Join(base, "目标", "来源(一)")
	mapper := NewPathMapper(source, source, destination)

	tests := []struct {
		name       string
		linkRel    string
		rawTarget  string
		wantKind   LinkMappingKind
		wantTarget string
	}{
		{
			name: "internal relative", linkRel: filepath.Join("sub", "link"), rawTarget: filepath.Join("..", "photo.jpg"),
			wantKind: MappingInternal, wantTarget: filepath.Join(destination, "photo.jpg"),
		},
		{
			name: "internal absolute", linkRel: "absolute", rawTarget: filepath.Join(source, "sub", "photo.jpg"),
			wantKind: MappingInternal, wantTarget: filepath.Join(destination, "sub", "photo.jpg"),
		},
		{
			name: "external relative", linkRel: filepath.Join("sub", "external"), rawTarget: filepath.Join("..", "..", "shared.jpg"),
			wantKind: MappingExternal, wantTarget: filepath.Join(base, "shared.jpg"),
		},
		{
			name: "another selected top level remains external", linkRel: "other", rawTarget: filepath.Join(base, "另一个来源", "file.jpg"),
			wantKind: MappingExternal, wantTarget: filepath.Join(base, "另一个来源", "file.jpg"),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sourceLink := filepath.Join(source, test.linkRel)
			destLink := filepath.Join(destination, test.linkRel)
			mapping, err := mapper.Map(sourceLink, destLink, test.rawTarget)
			if err != nil {
				t.Fatal(err)
			}
			if mapping.Kind != test.wantKind || mapping.FinalTarget != test.wantTarget {
				t.Fatalf("mapping = %+v", mapping)
			}
			wantText, err := filepath.Rel(filepath.Dir(destLink), test.wantTarget)
			if err != nil {
				wantText = test.wantTarget
			}
			if mapping.TargetText != wantText {
				t.Fatalf("target text = %q, want %q", mapping.TargetText, wantText)
			}
		})
	}
}

func TestPathMapperRecognizesConfiguredSourceAlias(t *testing.T) {
	base := filepath.Join(string(filepath.Separator), "srv")
	source := filepath.Join(base, "real", "source")
	alias := filepath.Join(base, "alias", "source")
	destination := filepath.Join(base, "dest", "source")
	mapper := NewPathMapper(source, alias, destination)

	mapping, err := mapper.Map(
		filepath.Join(source, "link"),
		filepath.Join(destination, "link"),
		filepath.Join(alias, "nested", "missing.jpg"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if mapping.Kind != MappingInternal || mapping.FinalTarget != filepath.Join(destination, "nested", "missing.jpg") {
		t.Fatalf("mapping = %+v", mapping)
	}
}

func TestRelativeLinkTargetUsesRelativePathWhenRepresentable(t *testing.T) {
	parent := filepath.Join(string(filepath.Separator), "data", "dest", "nested")
	target := filepath.Join(string(filepath.Separator), "data", "source", "file.txt")
	got := RelativeLinkTarget(parent, target)
	want, err := filepath.Rel(parent, target)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("target = %q, want %q", got, want)
	}
}
