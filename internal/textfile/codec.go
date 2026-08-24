package textfile

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

var (
	utf8BOM    = []byte{0xef, 0xbb, 0xbf}
	utf16LEBOM = []byte{0xff, 0xfe}
	utf16BEBOM = []byte{0xfe, 0xff}
)

func DecodeText(raw []byte) (DecodedText, error) {
	var (
		content  string
		encoding Encoding
		err      error
	)

	switch {
	case bytes.HasPrefix(raw, utf8BOM):
		body := raw[len(utf8BOM):]
		if !utf8.Valid(body) {
			return DecodedText{}, ErrInvalidText
		}
		content = string(body)
		encoding = EncodingUTF8BOM
	case bytes.HasPrefix(raw, utf16LEBOM):
		content, err = decodeUTF16(raw[len(utf16LEBOM):], binary.LittleEndian)
		encoding = EncodingUTF16LEBOM
	case bytes.HasPrefix(raw, utf16BEBOM):
		content, err = decodeUTF16(raw[len(utf16BEBOM):], binary.BigEndian)
		encoding = EncodingUTF16BEBOM
	case utf8.Valid(raw):
		content = string(raw)
		encoding = EncodingUTF8
	default:
		content, err = decodeGB18030(raw)
		encoding = EncodingGB18030
	}
	if err != nil {
		return DecodedText{}, fmt.Errorf("%w: %v", ErrInvalidText, err)
	}
	if looksBinary(content) {
		return DecodedText{}, ErrInvalidText
	}

	lineEnding, preferred := DetectLineEndings(content)
	return DecodedText{
		Content:             content,
		Encoding:            encoding,
		LineEnding:          lineEnding,
		PreferredLineEnding: preferred,
	}, nil
}

func EncodeText(content string, encoding Encoding, lineEnding LineEnding) ([]byte, error) {
	if !utf8.ValidString(content) || looksBinary(content) {
		return nil, ErrInvalidText
	}

	normalized, err := normalizeLineEndings(content, lineEnding)
	if err != nil {
		return nil, err
	}

	switch encoding {
	case EncodingUTF8:
		return []byte(normalized), nil
	case EncodingUTF8BOM:
		return append(append([]byte(nil), utf8BOM...), []byte(normalized)...), nil
	case EncodingUTF16LEBOM:
		return encodeUTF16(normalized, binary.LittleEndian, utf16LEBOM), nil
	case EncodingUTF16BEBOM:
		return encodeUTF16(normalized, binary.BigEndian, utf16BEBOM), nil
	case EncodingGB18030:
		encoded, encodeErr := simplifiedchinese.GB18030.NewEncoder().Bytes([]byte(normalized))
		if encodeErr != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidText, encodeErr)
		}
		return encoded, nil
	default:
		return nil, ErrUnsupportedEncoding
	}
}

func DetectLineEndings(content string) (LineEnding, LineEnding) {
	var lfCount, crlfCount, crCount int
	for i := 0; i < len(content); i++ {
		switch content[i] {
		case '\r':
			if i+1 < len(content) && content[i+1] == '\n' {
				crlfCount++
				i++
			} else {
				crCount++
			}
		case '\n':
			lfCount++
		}
	}

	kinds := 0
	for _, count := range []int{lfCount, crlfCount, crCount} {
		if count > 0 {
			kinds++
		}
	}
	if kinds == 0 {
		return LineEndingNone, LineEndingLF
	}

	preferred := LineEndingLF
	maxCount := lfCount
	if crlfCount > maxCount {
		preferred = LineEndingCRLF
		maxCount = crlfCount
	}
	if crCount > maxCount {
		preferred = LineEndingCR
	}
	if kinds > 1 {
		return LineEndingMixed, preferred
	}
	return preferred, preferred
}

func decodeUTF16(raw []byte, order binary.ByteOrder) (string, error) {
	if len(raw)%2 != 0 {
		return "", ErrInvalidText
	}
	units := make([]uint16, len(raw)/2)
	for i := range units {
		units[i] = order.Uint16(raw[i*2 : i*2+2])
	}

	runes := make([]rune, 0, len(units))
	for i := 0; i < len(units); i++ {
		unit := units[i]
		switch {
		case unit >= 0xd800 && unit <= 0xdbff:
			if i+1 >= len(units) || units[i+1] < 0xdc00 || units[i+1] > 0xdfff {
				return "", ErrInvalidText
			}
			runes = append(runes, utf16.DecodeRune(rune(unit), rune(units[i+1])))
			i++
		case unit >= 0xdc00 && unit <= 0xdfff:
			return "", ErrInvalidText
		default:
			runes = append(runes, rune(unit))
		}
	}
	return string(runes), nil
}

func decodeGB18030(raw []byte) (string, error) {
	if err := validateGB18030(raw); err != nil {
		return "", err
	}
	decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(raw)
	if err != nil || !utf8.Valid(decoded) {
		return "", ErrInvalidText
	}
	return string(decoded), nil
}

func validateGB18030(raw []byte) error {
	for offset := 0; offset < len(raw); {
		start := offset
		lead := raw[offset]
		switch {
		case lead <= 0x80:
			offset++
		case lead >= 0x81 && lead <= 0xfe:
			if offset+1 >= len(raw) {
				return ErrInvalidText
			}
			second := raw[offset+1]
			switch {
			case (second >= 0x40 && second <= 0x7e) || (second >= 0x80 && second <= 0xfe):
				offset += 2
			case second >= 0x30 && second <= 0x39:
				if offset+3 >= len(raw) || raw[offset+2] < 0x81 || raw[offset+2] > 0xfe ||
					raw[offset+3] < 0x30 || raw[offset+3] > 0x39 {
					return ErrInvalidText
				}
				offset += 4
			default:
				return ErrInvalidText
			}
		default:
			return ErrInvalidText
		}

		chunk := raw[start:offset]
		decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(chunk)
		if err != nil || !utf8.Valid(decoded) {
			return ErrInvalidText
		}
		if bytes.Equal(decoded, []byte(string(utf8.RuneError))) {
			canonical, encodeErr := simplifiedchinese.GB18030.NewEncoder().Bytes(decoded)
			if encodeErr != nil || !bytes.Equal(canonical, chunk) {
				return ErrInvalidText
			}
		}
	}
	return nil
}

func encodeUTF16(content string, order binary.ByteOrder, bom []byte) []byte {
	units := utf16.Encode([]rune(content))
	encoded := make([]byte, len(bom)+len(units)*2)
	copy(encoded, bom)
	for i, unit := range units {
		order.PutUint16(encoded[len(bom)+i*2:], unit)
	}
	return encoded
}

func normalizeLineEndings(content string, lineEnding LineEnding) (string, error) {
	separator := ""
	switch lineEnding {
	case LineEndingLF:
		separator = "\n"
	case LineEndingCRLF:
		separator = "\r\n"
	case LineEndingCR:
		separator = "\r"
	default:
		return "", ErrUnsupportedLineEnding
	}
	normalized := bytes.ReplaceAll([]byte(content), []byte("\r\n"), []byte("\n"))
	normalized = bytes.ReplaceAll(normalized, []byte("\r"), []byte("\n"))
	if separator != "\n" {
		normalized = bytes.ReplaceAll(normalized, []byte("\n"), []byte(separator))
	}
	return string(normalized), nil
}

func looksBinary(content string) bool {
	controlCount := 0
	runeCount := 0
	for _, r := range content {
		runeCount++
		if r == 0 {
			return true
		}
		if (r < 0x20 && r != '\t' && r != '\n' && r != '\r' && r != '\f') ||
			r == 0x7f || (r >= 0x80 && r <= 0x9f) {
			controlCount++
		}
	}
	return controlCount >= 3 && controlCount*10 >= runeCount
}
