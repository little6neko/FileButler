package natsort

import (
	"strings"
	"unicode/utf8"
)

func Less(a, b string) bool {
	if a == b {
		return false
	}
	ia, ib := 0, 0
	for ia < len(a) && ib < len(b) {
		ra, _ := utf8.DecodeRuneInString(a[ia:])
		rb, _ := utf8.DecodeRuneInString(b[ib:])
		if isDigit(ra) && isDigit(rb) {
			enda := digitEnd(a, ia)
			endb := digitEnd(b, ib)
			cmp := compareDigits(a[ia:enda], b[ib:endb])
			if cmp != 0 {
				return cmp < 0
			}
			ia, ib = enda, endb
			continue
		}
		enda := segmentEnd(a, ia)
		endb := segmentEnd(b, ib)
		sa := strings.ToLower(a[ia:enda])
		sb := strings.ToLower(b[ib:endb])
		if sa != sb {
			return sa < sb
		}
		ia, ib = enda, endb
	}
	if ia != len(a) || ib != len(b) {
		return len(a[ia:]) < len(b[ib:])
	}
	return a < b
}

func isDigit(r rune) bool {
	return r >= '0' && r <= '9'
}

func digitEnd(s string, i int) int {
	for i < len(s) {
		r, size := utf8.DecodeRuneInString(s[i:])
		if !isDigit(r) {
			break
		}
		i += size
	}
	return i
}

func segmentEnd(s string, i int) int {
	for i < len(s) {
		r, size := utf8.DecodeRuneInString(s[i:])
		if isDigit(r) {
			break
		}
		i += size
	}
	return i
}

func compareDigits(a, b string) int {
	ta := strings.TrimLeft(a, "0")
	tb := strings.TrimLeft(b, "0")
	if ta == "" {
		ta = "0"
	}
	if tb == "" {
		tb = "0"
	}
	if len(ta) != len(tb) {
		if len(ta) < len(tb) {
			return -1
		}
		return 1
	}
	if ta != tb {
		if ta < tb {
			return -1
		}
		return 1
	}
	if len(a) != len(b) {
		if len(a) < len(b) {
			return -1
		}
		return 1
	}
	return 0
}
