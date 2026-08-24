package textfile

import "errors"

const (
	HighlightLimit int64 = 2 << 20
	MaxFileSize    int64 = 10 << 20
)

type Encoding string

const (
	EncodingUTF8       Encoding = "utf-8"
	EncodingUTF8BOM    Encoding = "utf-8-bom"
	EncodingUTF16LEBOM Encoding = "utf-16le-bom"
	EncodingUTF16BEBOM Encoding = "utf-16be-bom"
	EncodingGB18030    Encoding = "gb18030"
)

type LineEnding string

const (
	LineEndingNone  LineEnding = "none"
	LineEndingLF    LineEnding = "lf"
	LineEndingCRLF  LineEnding = "crlf"
	LineEndingCR    LineEnding = "cr"
	LineEndingMixed LineEnding = "mixed"
)

type DecodedText struct {
	Content             string
	Encoding            Encoding
	LineEnding          LineEnding
	PreferredLineEnding LineEnding
}

var (
	ErrInvalidText           = errors.New("invalid text content")
	ErrUnsupportedEncoding   = errors.New("unsupported text encoding")
	ErrUnsupportedLineEnding = errors.New("unsupported line ending")
)
