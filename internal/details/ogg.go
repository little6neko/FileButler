package details

import (
	"bytes"
	"encoding/binary"
	"io"
)

// Theora identification headers and EOS granules, never packet/frame decoding.
// https://www.theora.org/doc/Theora.pdf Appendix A and section 6.2.
func (m *Media) ogg(r io.ReaderAt, size int64) {
	var serial uint32
	var fps float64
	var shift uint
	for off, count := int64(0), 0; off < size && count < 32; count++ {
		h := make([]byte, 27)
		if _, e := r.ReadAt(h, off); e != nil || string(h[:4]) != "OggS" || h[4] != 0 {
			return
		}
		lacing := make([]byte, int(h[26]))
		if _, e := r.ReadAt(lacing, off+27); e != nil {
			return
		}
		length := 0
		for _, n := range lacing {
			length += int(n)
		}
		start := off + 27 + int64(len(lacing))
		if int64(length) > size-start {
			return
		}
		if h[5]&2 != 0 && length >= 42 {
			header := make([]byte, 42)
			if _, e := r.ReadAt(header, start); e != nil {
				return
			}
			if string(header[:7]) == "\x80theora" {
				m.dimensions(int(header[14])<<16|int(header[15])<<8|int(header[16]), int(header[17])<<16|int(header[18])<<8|int(header[19]))
				numerator, denominator := binary.BigEndian.Uint32(header[22:26]), binary.BigEndian.Uint32(header[26:30])
				if numerator == 0 || denominator == 0 {
					return
				}
				fps = float64(numerator) / float64(denominator)
				serial = binary.LittleEndian.Uint32(h[14:18])
				shift = uint(binary.BigEndian.Uint16(header[40:42]) >> 5 & 31)
				break
			}
		}
		off = start + int64(length)
	}
	if fps == 0 {
		return
	}
	// Bounded tail scan. Without the matching EOS page, duration remains unknown.
	tail := make([]byte, min(size, 256<<10))
	if _, e := r.ReadAt(tail, size-int64(len(tail))); e != nil {
		return
	}
	for cursor := 0; cursor+27 <= len(tail); {
		found := bytes.Index(tail[cursor:], []byte("OggS"))
		if found < 0 {
			return
		}
		cursor += found
		h := tail[cursor:]
		if len(h) < 27 {
			return
		}
		segments := int(h[26])
		header := 27 + segments
		if len(h) < header {
			return
		}
		length := 0
		for _, n := range h[27:header] {
			length += int(n)
		}
		if h[4] == 0 && h[5]&4 != 0 && binary.LittleEndian.Uint32(h[14:18]) == serial && header+length <= len(h) {
			granule := binary.LittleEndian.Uint64(h[6:14])
			if granule>>63 == 0 {
				frames := (granule >> shift) + (granule & ((uint64(1) << shift) - 1))
				m.duration(float64(frames) / fps)
				return
			}
		}
		cursor++
	}
}
