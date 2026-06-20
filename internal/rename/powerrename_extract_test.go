package rename

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestExtractPowerRenameXMPPatterns(t *testing.T) {
	raw := []byte(`<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmp:CreatorTool="FileButlerTest" xmp:CreateDate="2026-06-20T18:07:09Z" xmpMM:DocumentID="doc-1"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Summer</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Alice</rdf:li></rdf:Seq></dc:creator><xmpRights:WebStatement>Copyright Alice</xmpRights:WebStatement></rdf:Description></rdf:RDF></x:xmpmeta>`)
	patterns := extractPowerRenameXMPPatterns(raw)
	if patterns["CREATOR_TOOL"] != "FileButlerTest" || patterns["TITLE"] != "Summer" || patterns["AUTHOR"] != "Alice" || patterns["COPYRIGHT"] != "Copyright Alice" || patterns["DOCUMENT_ID"] != "doc-1" {
		t.Fatalf("patterns=%+v", patterns)
	}
	if patterns["CREATE_DATE_YYYY"] != "2026" || patterns["CREATE_DATE_MM"] != "06" || patterns["CREATE_DATE_DD"] != "20" {
		t.Fatalf("date patterns=%+v", patterns)
	}
}

func TestBuildPowerRenameTemplateContextUsesFileTimes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "photo.jpg")
	if err := os.WriteFile(path, []byte("not an image"), 0o644); err != nil {
		t.Fatal(err)
	}
	mod := time.Date(2026, 6, 20, 18, 7, 9, 0, time.UTC)
	if err := os.Chtimes(path, mod, mod); err != nil {
		t.Fatal(err)
	}
	ctx := buildPowerRenameTemplateContext(path)
	if ctx.ModifiedTime.IsZero() || ctx.AccessTime.IsZero() {
		t.Fatalf("ctx=%+v", ctx)
	}
}
