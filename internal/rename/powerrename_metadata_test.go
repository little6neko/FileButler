package rename

import (
	"testing"
	"time"
)

func TestPowerRenameTimeTemplates(t *testing.T) {
	ctx := PowerRenameTemplateContext{
		CreationTime: time.Date(2026, 6, 20, 18, 7, 9, 0, time.UTC),
		ModifiedTime: time.Date(2026, 6, 21, 19, 8, 10, 0, time.UTC),
		AccessTime:   time.Date(2026, 6, 22, 20, 9, 11, 0, time.UTC),
	}
	got := renderPowerRenameMetadataTemplates("${creationtime:yyyy}-${modifiedtime:MM}-${accesstime:dd}", ctx)
	if got != "2026-06-22" {
		t.Fatalf("got=%q", got)
	}
}

func TestPowerRenameEXIFTemplates(t *testing.T) {
	ctx := PowerRenameTemplateContext{
		Metadata: map[string]string{
			"CAMERA_MODEL": "X100",
			"ISO":          "ISO 400",
			"WIDTH":        "6000",
		},
	}
	got := renderPowerRenameMetadataTemplates("${CAMERA_MODEL}-${ISO}-${WIDTH}", ctx)
	if got != "X100-ISO 400-6000" {
		t.Fatalf("got=%q", got)
	}
}
