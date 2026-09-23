package details

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestImageAndUnsupported(t *testing.T) {
	var b bytes.Buffer
	png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 384, 216)))
	m := Probe(context.Background(), bytes.NewReader(b.Bytes()), int64(b.Len()), "test.png")
	if m.Width == nil || *m.Width != 384 || *m.Height != 216 {
		t.Fatalf("%+v", m)
	}
	m = Probe(context.Background(), bytes.NewReader(b.Bytes()), int64(b.Len()), "test.avi")
	if m.Width != nil {
		t.Fatal("avi probed")
	}
}

func TestRemoteRejectsPrivateAndOverlayAddresses(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "10.1.2.3", "100.64.1.2", "169.254.169.254", "::1", "fd00::1", "::ffff:192.168.0.1"} {
		if publicMediaAddress(net.ParseIP(address)) {
			t.Fatalf("unsafe address accepted: %s", address)
		}
	}
	if !publicMediaAddress(net.ParseIP("8.8.8.8")) {
		t.Fatal("public address rejected")
	}
}
func atom(kind string, b []byte) []byte {
	out := make([]byte, len(b)+8)
	binary.BigEndian.PutUint32(out, uint32(len(out)))
	copy(out[4:8], kind)
	copy(out[8:], b)
	return out
}

type countedReader struct {
	io.ReaderAt
	n int
}

func (r *countedReader) ReadAt(b []byte, off int64) (int, error) {
	n, e := r.ReaderAt.ReadAt(b, off)
	r.n += n
	return n, e
}
func TestMovieTailSkipsPayload(t *testing.T) {
	header := make([]byte, 100)
	binary.BigEndian.PutUint32(header[12:16], 1000)
	binary.BigEndian.PutUint32(header[16:20], 1022000)
	track := make([]byte, 84)
	binary.BigEndian.PutUint32(track[76:80], 3840<<16)
	binary.BigEndian.PutUint32(track[80:84], 2160<<16)
	data := append(atom("mdat", make([]byte, 9<<20)), atom("moov", append(atom("mvhd", header), atom("trak", atom("tkhd", track))...))...)
	r := &countedReader{ReaderAt: bytes.NewReader(data)}
	m := Probe(context.Background(), r, int64(len(data)), "a.mp4")
	if m.Duration == nil || *m.Duration != 1022 || m.Width == nil || *m.Width != 3840 || *m.Height != 2160 || r.n > 1024 {
		t.Fatalf("%+v read=%d", m, r.n)
	}
}

func TestAVIFDoesNotReportThumbnailAsMainImage(t *testing.T) {
	spatial := func(w, h uint32) []byte {
		b := make([]byte, 12)
		binary.BigEndian.PutUint32(b[4:8], w)
		binary.BigEndian.PutUint32(b[8:12], h)
		return atom("ispe", b)
	}
	data := atom("ipco", append(spatial(3840, 2160), spatial(320, 180)...))
	got := Probe(context.Background(), bytes.NewReader(data), int64(len(data)), "a.avif")
	if got.Width != nil || got.Height != nil {
		t.Fatal("ambiguous AVIF reported arbitrary dimensions")
	}
}
func TestBudgetAndCancellation(t *testing.T) {
	r := &countedReader{ReaderAt: bytes.NewReader(make([]byte, 20))}
	b := &budgetReader{ctx: context.Background(), source: r, left: 8}
	if _, e := b.ReadAt(make([]byte, 9), 0); e == nil || r.n != 0 {
		t.Fatal("budget exceeded")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	b.ctx = ctx
	if _, e := b.ReadAt(make([]byte, 1), 0); e == nil {
		t.Fatal("cancellation ignored")
	}
}
func TestRemoteRejectsIgnoredRange(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200); w.Write([]byte("data")) }))
	defer s.Close()
	r := NewRemoteReader(context.Background(), s.URL, "", 4)
	r.Client = s.Client()
	if _, e := r.ReadAt(make([]byte, 1), 0); e == nil {
		t.Fatal("download fallback allowed")
	}
}
func TestRemoteUsesSmallRangesAndCache(t *testing.T) {
	calls := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Range") != "bytes=0-3" {
			t.Error(r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", "bytes 0-3/4")
		w.WriteHeader(206)
		w.Write([]byte("data"))
	}))
	defer s.Close()
	r := NewRemoteReader(context.Background(), s.URL, "", 4)
	r.Client = s.Client()
	b := make([]byte, 1)
	if _, e := r.ReadAt(b, 0); e != nil {
		t.Fatal(e)
	}
	if _, e := r.ReadAt(b, 2); e != nil || b[0] != 't' || calls != 1 {
		t.Fatalf("%v %s %d", e, b, calls)
	}
}
