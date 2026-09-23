// Package details provides read-only, cancellable file properties.
package details

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
)

type Request struct {
	RootID string   `json:"rootId"`
	Paths  []string `json:"paths"`
}
type Item struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Path      string `json:"path"`
	Location  string `json:"location"`
	Size      int64  `json:"size"`
	Allocated *int64 `json:"allocated"`
	Modified  *int64 `json:"modifiedUnix"`
	Created   *int64 `json:"createdUnix"`
	SHA1      string `json:"sha1"`
	Warning   string `json:"warning,omitempty"`
}
type Totals struct {
	Size      int64  `json:"size"`
	Allocated *int64 `json:"allocated"`
	Files     int64  `json:"files"`
	Folders   int64  `json:"folders"`
}
type Service struct {
	Roots roots.Resolver
	DB    *storage.Store
}

var slots = make(chan struct{}, 4)

func Acquire(ctx context.Context) (func(), error) {
	select {
	case slots <- struct{}{}:
		return func() { <-slots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (s Service) resolve(req Request) ([]roots.ResolvedPath, error) {
	if len(req.Paths) == 0 || len(req.Paths) > 1000 {
		return nil, errors.New("请选择文件或文件夹")
	}
	out := make([]roots.ResolvedPath, 0, len(req.Paths))
	for _, p := range req.Paths {
		r, e := s.Roots.ResolveEntry(req.RootID, p)
		// A configured root is a valid details target, although it is not a
		// renameable directory entry. Preserve no-follow semantics elsewhere.
		if p == "" || filepath.Clean(p) == "." {
			r, e = s.Roots.ResolveFollow(req.RootID, p)
		}
		if e != nil {
			return nil, e
		}
		out = append(out, roots.ResolvedPath{Root: r.Actual.Root, Rel: r.Actual.Rel, Abs: r.Actual.Abs})
	}
	return out, nil
}
func version(info os.FileInfo) string {
	if !info.Mode().IsRegular() {
		return ""
	}
	return snapshot(info)
}
func snapshot(info os.FileInfo) string {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return ""
	}
	b, _ := json.Marshal([]any{st.Dev, st.Ino, st.Mode, info.Size(), st.Mtim.Sec*1e9 + st.Mtim.Nsec, st.Ctim.Sec*1e9 + st.Ctim.Nsec})
	return string(b)
}
func allocated(info os.FileInfo) *int64 {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		n := st.Blocks * 512
		return &n
	}
	return nil
}
func (s Service) hashRecord(path string, info os.FileInfo) (storage.Hash, error) {
	mapped, e := s.Roots.MapPath(path)
	if e != nil {
		return storage.Hash{}, e
	}
	return storage.Hash{Scope: storage.LocalScope(mapped.Root.ID, mapped.Root.Path), Path: filepath.ToSlash(mapped.Rel), Version: version(info), Origin: "local"}, nil
}
func (s Service) Basic(ctx context.Context, req Request) ([]Item, error) {
	paths, e := s.resolve(req)
	if e != nil {
		return nil, e
	}
	out := make([]Item, 0, len(paths))
	for _, p := range paths {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		info, e := os.Lstat(p.Abs)
		if e != nil {
			return nil, e
		}
		kind := "file"
		if info.IsDir() {
			kind = "directory"
		} else if info.Mode()&os.ModeSymlink != 0 {
			kind = "symlink"
		} else if !info.Mode().IsRegular() {
			kind = "other"
		}
		modified := info.ModTime().Unix()
		location := filepath.Dir(p.Abs)
		if p.Rel == "." {
			location = p.Abs
		}
		item := Item{Name: info.Name(), Type: kind, Path: filepath.ToSlash(p.Rel), Location: location, Size: info.Size(), Allocated: allocated(info), Modified: &modified, Created: birthTime(p.Abs)}
		if len(paths) == 1 && kind == "file" && s.DB != nil {
			h, e := s.hashRecord(p.Abs, info)
			if e != nil {
				return nil, e
			}
			st := info.Sys().(*syscall.Stat_t)
			if time.Since(info.ModTime()) >= 2*time.Second && time.Since(time.Unix(st.Ctim.Sec, st.Ctim.Nsec)) >= 2*time.Second {
				item.SHA1, e = s.DB.Hash(ctx, h)
				if e != nil {
					item.Warning = "SHA1缓存暂时无法读取"
				}
			}
		}
		out = append(out, item)
	}
	return out, nil
}
func (s Service) Stats(ctx context.Context, req Request) (Totals, error) {
	release, e := Acquire(ctx)
	if e != nil {
		return Totals{}, e
	}
	defer release()
	paths, e := s.resolve(req)
	if e != nil {
		return Totals{}, e
	}
	total := Totals{}
	n := int64(0)
	total.Allocated = &n
	seen := map[string]bool{}
	blocks := map[[2]uint64]bool{}
	// Walking from os.Root prevents a concurrently replaced parent from escaping its root.
	for _, p := range paths {
		covered := false
		for _, other := range paths {
			if p.Abs != other.Abs && strings.HasPrefix(p.Abs, other.Abs+string(os.PathSeparator)) {
				i, err := os.Lstat(other.Abs)
				if err == nil && i.IsDir() {
					covered = true
					break
				}
			}
		}
		if covered {
			continue
		}
		root, err := os.OpenRoot(p.Root.Path)
		if err != nil {
			return Totals{}, err
		}
		directories := map[string]string{}
		visit := func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			key := filepath.Join(p.Root.Path, path)
			if seen[key] {
				if d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			seen[key] = true
			info, err := d.Info()
			if err != nil {
				return err
			}
			if info.IsDir() {
				directories[path] = snapshot(info)
				total.Folders++
			} else {
				total.Files++
				total.Size += info.Size()
			}
			a := allocated(info)
			if a == nil {
				total.Allocated = nil
			} else if total.Allocated != nil {
				st := info.Sys().(*syscall.Stat_t)
				id := [2]uint64{uint64(st.Dev), st.Ino}
				if !blocks[id] {
					*total.Allocated += *a
					blocks[id] = true
				}
			}
			return nil
		}
		initial, statErr := root.Lstat(p.Rel)
		if statErr != nil {
			root.Close()
			return Totals{}, statErr
		}
		if initial.Mode()&os.ModeSymlink != 0 {
			err = visit(filepath.ToSlash(p.Rel), fs.FileInfoToDirEntry(initial), nil)
		} else {
			err = fs.WalkDir(root.FS(), filepath.ToSlash(p.Rel), visit)
		}
		if err == nil {
			for path, before := range directories {
				if err = ctx.Err(); err != nil {
					break
				}
				info, e := root.Lstat(path)
				if e != nil || snapshot(info) != before {
					err = errors.New("目录在统计时发生变化，请重新打开详细信息")
					break
				}
			}
		}
		root.Close()
		if err != nil {
			return Totals{}, err
		}
	}
	if len(paths) == 1 {
		info, err := os.Lstat(paths[0].Abs)
		if err != nil {
			return Totals{}, err
		}
		if info.IsDir() {
			total.Folders--
		}
	}
	return total, nil
}
func (s Service) Open(req Request) (*os.File, error) {
	paths, e := s.resolve(req)
	if e != nil {
		return nil, e
	}
	if len(paths) != 1 {
		return nil, errors.New("请选择一个文件")
	}
	p := paths[0]
	root, e := os.OpenRoot(p.Root.Path)
	if e != nil {
		return nil, e
	}
	defer root.Close()
	info, e := root.Lstat(p.Rel)
	if e != nil {
		return nil, e
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("只支持普通文件")
	}
	f, e := root.OpenFile(p.Rel, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if e != nil {
		return nil, e
	}
	actual, e := f.Stat()
	if e != nil || !actual.Mode().IsRegular() || !os.SameFile(info, actual) {
		f.Close()
		return nil, errors.New("文件已变化")
	}
	return f, nil
}
func (s Service) Hash(ctx context.Context, req Request) (map[string]string, error) {
	release, e := Acquire(ctx)
	if e != nil {
		return nil, e
	}
	defer release()
	f, e := s.Open(req)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	before, e := f.Stat()
	if e != nil {
		return nil, e
	}
	digest := sha1.New()
	buffer := make([]byte, 256*1024)
	for {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		n, err := f.Read(buffer)
		digest.Write(buffer[:n])
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
	}
	after, e := f.Stat()
	if e != nil {
		return nil, e
	}
	canonical, e := filepath.EvalSymlinks(f.Name())
	if e != nil {
		return nil, e
	}
	current, e := os.Lstat(canonical)
	if e != nil {
		return nil, e
	}
	if version(before) != version(after) || version(after) != version(current) {
		return nil, errors.New("文件在计算时发生变化，请重新获取")
	}
	h, e := s.hashRecord(canonical, after)
	if e != nil {
		return nil, e
	}
	h.SHA1 = strings.ToUpper(hex.EncodeToString(digest.Sum(nil)))
	out := map[string]string{"sha1": h.SHA1}
	if s.DB == nil {
		return out, nil
	}
	if e = s.DB.PutHash(ctx, h); e != nil {
		out["warning"] = "SHA1已计算，但缓存保存失败"
	}
	return out, nil
}
