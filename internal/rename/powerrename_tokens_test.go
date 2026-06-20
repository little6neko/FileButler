package rename

import (
	"regexp"
	"testing"
)

func TestPowerRenameEnumerationDefaultToken(t *testing.T) {
	rendered, changed, err := renderPowerRenameTokens("photo-${}.jpg", 7, deterministicRandom{})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || rendered != "photo-7.jpg" {
		t.Fatalf("rendered=%q changed=%v", rendered, changed)
	}
}

func TestPowerRenameEnumerationOptions(t *testing.T) {
	rendered, changed, err := renderPowerRenameTokens("photo-${start=10;increment=2;padding=3}.jpg", 3, deterministicRandom{})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || rendered != "photo-014.jpg" {
		t.Fatalf("rendered=%q changed=%v", rendered, changed)
	}
}

func TestPowerRenameEnumerationOptionsAcceptCommaAndWhitespace(t *testing.T) {
	rendered, changed, err := renderPowerRenameTokens("photo-${start=1, padding=2}.jpg", 1, deterministicRandom{})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || rendered != "photo-01.jpg" {
		t.Fatalf("rendered=%q changed=%v", rendered, changed)
	}
}

func TestPowerRenameRandomTokens(t *testing.T) {
	rendered, changed, err := renderPowerRenameTokens("${rstringalpha=3}-${rstringdigit=4}-${rstringalnum=5}-${ruuidv4}", 1, deterministicRandom{})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected random tokens to render")
	}
	if !regexp.MustCompile(`^[A-Za-z]{3}-[0-9]{4}-[A-Za-z0-9]{5}-[0-9a-fA-F-]{36}$`).MatchString(rendered) {
		t.Fatalf("rendered=%q", rendered)
	}
}
