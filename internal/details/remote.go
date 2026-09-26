package details

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

// A small ranged reader with its own wire-byte budget. Never falls back to 200.
type RemoteReader struct {
	Context   context.Context
	URL       string
	UserAgent string
	Size      int64
	Client    *http.Client
	left      int64
	start     int64
	block     []byte
}

func NewRemoteReader(ctx context.Context, url, agent string, size int64) *RemoteReader {
	return &RemoteReader{Context: ctx, URL: url, UserAgent: agent, Size: size, left: MediaBudget, Client: newRemoteClient()}
}

func newRemoteClient() *http.Client {
	return &http.Client{Transport: safeTransport, Timeout: 10 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("too many redirects")
		}
		return validateURL(req.URL)
	}}
}
func validateURL(u *url.URL) error {
	if (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
		return errors.New("invalid media URL")
	}
	return nil
}

var reservedMediaNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001:db8::/32"),
}

func publicMediaAddress(ip net.IP) bool {
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	address = address.Unmap()
	for _, network := range reservedMediaNetworks {
		if network.Contains(address) {
			return false
		}
	}
	return true
}

var safeTransport = &http.Transport{DisableCompression: true, ResponseHeaderTimeout: 5 * time.Second, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, e := net.SplitHostPort(address)
	if e != nil {
		return nil, e
	}
	ips, e := net.DefaultResolver.LookupIPAddr(ctx, host)
	if e != nil {
		return nil, e
	}
	for _, a := range ips {
		if !publicMediaAddress(a.IP) {
			return nil, errors.New("non-public media host")
		}
	}
	for _, a := range ips {
		c, e := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(a.IP.String(), port))
		if e == nil {
			return c, nil
		}
	}
	return nil, errors.New("media connection failed")
}}

func (r *RemoteReader) ReadAt(p []byte, off int64) (int, error) {
	if off < 0 {
		return 0, errors.New("invalid offset")
	}
	done := 0
	for len(p) > 0 {
		if e := r.Context.Err(); e != nil {
			return done, e
		}
		if off >= r.Size {
			return done, io.EOF
		}
		if len(r.block) == 0 || off < r.start || off >= r.start+int64(len(r.block)) {
			size := min(int64(32<<10), r.Size-off, r.left)
			if size <= 0 {
				return done, errors.New("media read budget exceeded")
			}
			req, e := http.NewRequestWithContext(r.Context, "GET", r.URL, nil)
			if e != nil {
				return done, e
			}
			if e = validateURL(req.URL); e != nil {
				return done, e
			}
			req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", off, off+size-1))
			req.Header.Set("User-Agent", r.UserAgent)
			req.Header.Set("Accept-Encoding", "identity")
			res, e := r.Client.Do(req)
			if e != nil {
				return done, errors.New("media request failed")
			}
			var first, last, total int64
			_, rangeErr := fmt.Sscanf(res.Header.Get("Content-Range"), "bytes %d-%d/%d", &first, &last, &total)
			if res.StatusCode != 206 || rangeErr != nil || first != off || last != off+size-1 || total != r.Size || (res.Header.Get("Content-Encoding") != "" && !strings.EqualFold(res.Header.Get("Content-Encoding"), "identity")) {
				res.Body.Close()
				return done, errors.New("media range unavailable")
			}
			block := make([]byte, size)
			n, e := io.ReadFull(res.Body, block)
			res.Body.Close()
			r.left -= int64(n)
			if e != nil {
				return done, e
			}
			r.start = off
			r.block = block
		}
		n := copy(p, r.block[off-r.start:])
		done += n
		off += int64(n)
		p = p[n:]
	}
	return done, nil
}
