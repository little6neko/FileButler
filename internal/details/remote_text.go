package details

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

var ErrRemoteTooLarge = errors.New("remote content exceeds size limit")

// ReadRemote reads a bounded response through the same public-address-only
// transport used for media metadata. No cookies or authorization are forwarded.
func ReadRemote(ctx context.Context, url, agent string, limit int64) ([]byte, error) {
	return readRemote(ctx, newRemoteClient(), url, agent, limit)
}

func readRemote(ctx context.Context, client *http.Client, rawURL, agent string, limit int64) ([]byte, error) {
	if limit < 0 {
		return nil, ErrRemoteTooLarge
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, errors.New("无效的115文本下载地址")
	}
	if err = validateURL(req.URL); err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", agent)
	req.Header.Set("Accept-Encoding", "identity")
	// Never include a signed query or credentials in diagnostics.
	endpoint := "GET " + req.URL.Scheme + "://" + req.URL.Host + req.URL.EscapedPath()
	res, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%s\n115文本下载失败（连接、超时或地址安全检查失败）", endpoint)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s\nHTTP %d %s", endpoint, res.StatusCode, http.StatusText(res.StatusCode))
	}
	if res.ContentLength > limit {
		return nil, ErrRemoteTooLarge
	}
	if encoding := res.Header.Get("Content-Encoding"); encoding != "" && !strings.EqualFold(encoding, "identity") {
		return nil, fmt.Errorf("%s\n不支持压缩的文本下载响应", endpoint)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%s\n115文本响应读取失败", endpoint)
	}
	if int64(len(data)) > limit {
		return nil, ErrRemoteTooLarge
	}
	return data, nil
}
