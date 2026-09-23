package details

import (
	"context"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const MediaBudget int64 = 8 << 20

type Media struct {
	Width            *int     `json:"width"`
	Height           *int     `json:"height"`
	Duration         *float64 `json:"duration"`
	ambiguousSpatial bool
}
type budgetReader struct {
	ctx    context.Context
	source io.ReaderAt
	left   int64
}

func (r *budgetReader) ReadAt(b []byte, off int64) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if int64(len(b)) > r.left {
		return 0, errors.New("media read budget exceeded")
	}
	n, e := r.source.ReadAt(b, off)
	r.left -= int64(n)
	return n, e
}
func (m *Media) dimensions(w, h int) {
	if w > 0 && h > 0 {
		m.Width = &w
		m.Height = &h
	}
}
func (m *Media) duration(n float64) {
	if n >= 0 && !math.IsNaN(n) && !math.IsInf(n, 0) {
		m.Duration = &n
	}
}

// Probe never decodes frames. Unsupported/truncated metadata simply stays unknown.
func Probe(ctx context.Context, source io.ReaderAt, size int64, name string) Media {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	r := &budgetReader{ctx: ctx, source: source, left: MediaBudget}
	m := Media{}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".gif":
		if c, _, e := image.DecodeConfig(io.NewSectionReader(r, 0, size)); e == nil {
			m.dimensions(c.Width, c.Height)
		}
	case ".bmp":
		b := make([]byte, 26)
		if _, e := r.ReadAt(b, 0); e == nil && string(b[:2]) == "BM" {
			if binary.LittleEndian.Uint32(b[14:18]) == 12 {
				m.dimensions(int(binary.LittleEndian.Uint16(b[18:20])), int(binary.LittleEndian.Uint16(b[20:22])))
			} else {
				w, h := int(int32(binary.LittleEndian.Uint32(b[18:22]))), int(int32(binary.LittleEndian.Uint32(b[22:26])))
				if h < 0 {
					h = -h
				}
				m.dimensions(w, h)
			}
		}
	case ".svg":
		decoder := xml.NewDecoder(io.NewSectionReader(r, 0, min(size, MediaBudget)))
		for {
			t, e := decoder.Token()
			if e != nil {
				break
			}
			if start, ok := t.(xml.StartElement); ok && start.Name.Local == "svg" {
				w, h := 0, 0
				var box []string
				for _, a := range start.Attr {
					switch a.Name.Local {
					case "width":
						w, _ = strconv.Atoi(strings.TrimSuffix(a.Value, "px"))
					case "height":
						h, _ = strconv.Atoi(strings.TrimSuffix(a.Value, "px"))
					case "viewBox":
						box = strings.Fields(strings.ReplaceAll(a.Value, ",", " "))
					}
				}
				if (w <= 0 || h <= 0) && len(box) == 4 {
					fw, _ := strconv.ParseFloat(box[2], 64)
					fh, _ := strconv.ParseFloat(box[3], 64)
					w, h = int(fw), int(fh)
				}
				m.dimensions(w, h)
				break
			}
		}
	case ".webp":
		b := make([]byte, 30)
		if _, e := r.ReadAt(b, 0); e == nil && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
			switch string(b[12:16]) {
			case "VP8X":
				w := int(b[24]) | int(b[25])<<8 | int(b[26])<<16
				h := int(b[27]) | int(b[28])<<8 | int(b[29])<<16
				m.dimensions(w+1, h+1)
			case "VP8 ":
				if string(b[23:26]) == "\x9d\x01\x2a" {
					m.dimensions(int(binary.LittleEndian.Uint16(b[26:28])&0x3fff), int(binary.LittleEndian.Uint16(b[28:30])&0x3fff))
				}
			case "VP8L":
				if b[20] == 0x2f {
					v := binary.LittleEndian.Uint32(b[21:25])
					m.dimensions(int(v&0x3fff)+1, int(v>>14&0x3fff)+1)
				}
			}
		}
	case ".mp4", ".m4v", ".mov":
		m.atoms(r, 0, size, 0)
	case ".avif":
		m.atoms(r, 0, size, 0)
		// Multi-item AVIF may contain thumbnails or grid tiles. Do not label
		// an arbitrary item's dimensions as those of the primary image.
		if m.ambiguousSpatial {
			m.Width, m.Height = nil, nil
		}
	case ".webm", ".mkv":
		scale, duration := float64(1e6), float64(-1)
		m.ebml(r, 0, size, 0, &scale, &duration)
		if duration >= 0 {
			m.duration(duration * scale / 1e9)
		}
	case ".ogg", ".ogv":
		m.ogg(r, size)
	}
	return m
}

// QuickTime/ISO BMFF atoms use offsets, allowing mdat to be skipped entirely.
// Field layout: developer.apple.com/documentation/quicktime-file-format/movie_header_atom
func (m *Media) atoms(r io.ReaderAt, start, end int64, depth int) {
	if depth > 12 {
		return
	}
	for off := start; off <= end-8; {
		head := make([]byte, 8)
		if _, e := r.ReadAt(head, off); e != nil {
			return
		}
		n := int64(binary.BigEndian.Uint32(head))
		header := int64(8)
		if n == 1 {
			b := make([]byte, 8)
			if _, e := r.ReadAt(b, off+8); e != nil {
				return
			}
			u := binary.BigEndian.Uint64(b)
			if u > math.MaxInt64 {
				return
			}
			n = int64(u)
			header = 16
		} else if n == 0 {
			n = end - off
		}
		if n < header || n > end-off {
			return
		}
		data := off + header
		length := n - header
		switch string(head[4:8]) {
		case "moov", "trak", "mdia", "iprp", "ipco":
			m.atoms(r, data, off+n, depth+1)
		case "meta":
			if length >= 4 {
				m.atoms(r, data+4, off+n, depth+1)
			}
		case "mvhd":
			b := make([]byte, min(length, 32))
			if _, e := r.ReadAt(b, data); e == nil && len(b) >= 20 {
				if b[0] == 0 {
					scale := binary.BigEndian.Uint32(b[12:16])
					dur := binary.BigEndian.Uint32(b[16:20])
					if scale > 0 && dur != math.MaxUint32 {
						m.duration(float64(dur) / float64(scale))
					}
				} else if b[0] == 1 && len(b) >= 32 {
					scale := binary.BigEndian.Uint32(b[20:24])
					dur := binary.BigEndian.Uint64(b[24:32])
					if scale > 0 && dur != math.MaxUint64 {
						m.duration(float64(dur) / float64(scale))
					}
				}
			}
		case "tkhd":
			b := make([]byte, min(length, 96))
			if _, e := r.ReadAt(b, data); e == nil && len(b) >= 84 {
				pos := 76
				if b[0] == 1 {
					pos = 88
				} else if b[0] != 0 {
					return
				}
				if len(b) >= pos+8 && m.Width == nil {
					m.dimensions(int(binary.BigEndian.Uint32(b[pos:pos+4])>>16), int(binary.BigEndian.Uint32(b[pos+4:pos+8])>>16))
				}
			}
		case "ispe":
			if length >= 12 {
				b := make([]byte, 12)
				if _, e := r.ReadAt(b, data); e == nil {
					w, h := int(binary.BigEndian.Uint32(b[4:8])), int(binary.BigEndian.Uint32(b[8:12]))
					if m.Width == nil {
						m.dimensions(w, h)
					} else if *m.Width != w || m.Height == nil || *m.Height != h {
						m.ambiguousSpatial = true
					}
				}
			}
		}
		off += n
	}
}
func vint(r io.ReaderAt, off int64, identifier bool) (uint64, int, error) {
	b := make([]byte, 1)
	if _, e := r.ReadAt(b, off); e != nil {
		return 0, 0, e
	}
	n := 1
	mask := byte(0x80)
	for n <= 8 && b[0]&mask == 0 {
		n++
		mask >>= 1
	}
	if n > 8 {
		return 0, 0, errors.New("invalid EBML")
	}
	value := uint64(b[0])
	if !identifier {
		value = uint64(b[0] &^ mask)
	}
	tail := make([]byte, n-1)
	if n > 1 {
		if _, e := r.ReadAt(tail, off+1); e != nil {
			return 0, 0, e
		}
	}
	for _, x := range tail {
		value = value<<8 | uint64(x)
	}
	return value, n, nil
}

// Element definitions: https://www.matroska.org/technical/elements.html
func (m *Media) ebml(r io.ReaderAt, start, end int64, depth int, scale, duration *float64) {
	if depth > 10 {
		return
	}
	for off := start; off < end; {
		id, a, e := vint(r, off, true)
		if e != nil {
			return
		}
		length, b, e := vint(r, off+int64(a), false)
		if e != nil {
			return
		}
		data := off + int64(a+b)
		n := int64(length)
		if length == (uint64(1)<<uint(7*b))-1 {
			if id != 0x18538067 {
				return
			}
			n = end - data
		}
		if n < 0 || data > end || n > end-data {
			return
		}
		switch id {
		case 0x18538067, 0x1549A966, 0x1654AE6B, 0xAE, 0xE0:
			m.ebml(r, data, data+n, depth+1, scale, duration)
		case 0x2AD7B1, 0x4489, 0xB0, 0xBA:
			if n > 0 && n <= 8 {
				bytes := make([]byte, n)
				if _, e := r.ReadAt(bytes, data); e != nil {
					return
				}
				var v uint64
				for _, x := range bytes {
					v = v<<8 | uint64(x)
				}
				switch id {
				case 0x2AD7B1:
					if v > 0 {
						*scale = float64(v)
					}
				case 0x4489:
					if n == 4 {
						*duration = float64(math.Float32frombits(uint32(v)))
					} else if n == 8 {
						*duration = math.Float64frombits(v)
					}
				case 0xB0:
					if m.Width == nil && v > 0 && v < math.MaxInt32 {
						x := int(v)
						m.Width = &x
					}
				case 0xBA:
					if m.Height == nil && v > 0 && v < math.MaxInt32 {
						x := int(v)
						m.Height = &x
					}
				}
			}
		}
		off = data + n
	}
}
