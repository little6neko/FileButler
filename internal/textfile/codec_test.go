package textfile

import (
	"bytes"
	"errors"
	"testing"
)

func TestDecodeTextDetectsSupportedEncodings(t *testing.T) {
	tests := []struct {
		name     string
		raw      []byte
		content  string
		encoding Encoding
	}{
		{name: "utf8", raw: []byte("hello 世界\n"), content: "hello 世界\n", encoding: EncodingUTF8},
		{name: "utf8 bom", raw: append([]byte{0xef, 0xbb, 0xbf}, []byte("hello 世界\n")...), content: "hello 世界\n", encoding: EncodingUTF8BOM},
		{name: "utf16 little endian", raw: []byte{0xff, 0xfe, 'A', 0, 0x2d, 0x4e, '\n', 0}, content: "A中\n", encoding: EncodingUTF16LEBOM},
		{name: "utf16 big endian", raw: []byte{0xfe, 0xff, 0, 'A', 0x4e, 0x2d, 0, '\n'}, content: "A中\n", encoding: EncodingUTF16BEBOM},
		{name: "gb18030", raw: []byte{0xd6, 0xd0, 0xce, 0xc4, '\r', '\n'}, content: "中文\r\n", encoding: EncodingGB18030},
		{name: "gb18030 euro extension", raw: []byte{0x80}, content: "€", encoding: EncodingGB18030},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			decoded, err := DecodeText(test.raw)
			if err != nil {
				t.Fatalf("DecodeText: %v", err)
			}
			if decoded.Content != test.content || decoded.Encoding != test.encoding {
				t.Fatalf("decoded=%+v", decoded)
			}
		})
	}
}

func TestDecodeTextRejectsMalformedAndBinaryContent(t *testing.T) {
	tests := [][]byte{
		{0xff},
		{0x81},
		{0x81, 0x20},
		{0xfe, 0xfe},
		{0xff, 0xfe, 'A'},
		[]byte("plain\x00text"),
		{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
	}
	for _, raw := range tests {
		if _, err := DecodeText(raw); !errors.Is(err, ErrInvalidText) {
			t.Fatalf("DecodeText(%v) err=%v", raw, err)
		}
	}
}

func TestEncodeTextRoundTripsEverySupportedEncoding(t *testing.T) {
	encodings := []Encoding{
		EncodingUTF8,
		EncodingUTF8BOM,
		EncodingUTF16LEBOM,
		EncodingUTF16BEBOM,
		EncodingGB18030,
	}
	for _, encoding := range encodings {
		t.Run(string(encoding), func(t *testing.T) {
			raw, err := EncodeText("第一行\nsecond line\n", encoding, LineEndingCRLF)
			if err != nil {
				t.Fatalf("EncodeText: %v", err)
			}
			decoded, err := DecodeText(raw)
			if err != nil {
				t.Fatalf("DecodeText: %v", err)
			}
			if decoded.Content != "第一行\r\nsecond line\r\n" || decoded.Encoding != encoding {
				t.Fatalf("decoded=%+v raw=%v", decoded, raw)
			}
		})
	}
}

func TestEncodeTextPreservesBOMPolicy(t *testing.T) {
	withoutBOM, err := EncodeText("a", EncodingUTF8, LineEndingLF)
	if err != nil {
		t.Fatal(err)
	}
	withBOM, err := EncodeText("a", EncodingUTF8BOM, LineEndingLF)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.HasPrefix(withoutBOM, []byte{0xef, 0xbb, 0xbf}) || !bytes.HasPrefix(withBOM, []byte{0xef, 0xbb, 0xbf}) {
		t.Fatalf("without=%v with=%v", withoutBOM, withBOM)
	}
}

func TestDetectLineEndingsFindsSingleMixedAndNone(t *testing.T) {
	tests := []struct {
		name      string
		content   string
		detected  LineEnding
		preferred LineEnding
	}{
		{name: "none", content: "one line", detected: LineEndingNone, preferred: LineEndingLF},
		{name: "lf", content: "a\nb\n", detected: LineEndingLF, preferred: LineEndingLF},
		{name: "crlf", content: "a\r\nb\r\n", detected: LineEndingCRLF, preferred: LineEndingCRLF},
		{name: "cr", content: "a\rb\r", detected: LineEndingCR, preferred: LineEndingCR},
		{name: "mixed majority", content: "a\r\nb\r\nc\n", detected: LineEndingMixed, preferred: LineEndingCRLF},
		{name: "mixed tie prefers lf", content: "a\r\nb\n", detected: LineEndingMixed, preferred: LineEndingLF},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			detected, preferred := DetectLineEndings(test.content)
			if detected != test.detected || preferred != test.preferred {
				t.Fatalf("DetectLineEndings=%q,%q", detected, preferred)
			}
		})
	}
}

func TestEncodeTextRejectsUnsupportedParameters(t *testing.T) {
	if _, err := EncodeText("x", Encoding("shift-jis"), LineEndingLF); !errors.Is(err, ErrUnsupportedEncoding) {
		t.Fatalf("encoding err=%v", err)
	}
	if _, err := EncodeText("x", EncodingUTF8, LineEndingMixed); !errors.Is(err, ErrUnsupportedLineEnding) {
		t.Fatalf("line ending err=%v", err)
	}
}
