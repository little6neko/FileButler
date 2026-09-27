package extract

import (
	"archive/tar"
	"compress/bzip2"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
)

type Request struct {
	SourceRoot string `json:"sourceRoot"`
	SourcePath string `json:"sourcePath"`
	DestRoot   string `json:"destRoot"`
	DestPath   string `json:"destPath"`
	Name       string `json:"name"`
	Password   string `json:"password"`
}

type Service struct{ Roots roots.Resolver }

var suffixes = []string{".tar.gz", ".tar.bz2", ".tar.xz", ".tgz", ".tbz2", ".txz", ".zip", ".7z", ".rar", ".tar"}

func DefaultName(name string) string {
	for _, suffix := range suffixes {
		if strings.HasSuffix(strings.ToLower(name), suffix) {
			return name[:len(name)-len(suffix)]
		}
	}
	return ""
}

func (s Service) Validate(req Request) error {
	if req.Name != "" {
		if err := safeName(req.Name); err != nil {
			return err
		}
	}
	if strings.Contains(req.Name, "/") || len(req.Name) > 255 {
		return errors.New("输出文件夹名称无效")
	}
	if len(req.Password) > 1024 || strings.ContainsAny(req.Password, "\r\n\x00") {
		return errors.New("密码过长或包含不支持的换行字符")
	}
	if DefaultName(filepath.Base(req.SourcePath)) == "" {
		return errors.New("不支持此压缩包格式")
	}
	if _, err := findTool(); err != nil {
		return err
	}
	source, err := s.Roots.ResolveEntry(req.SourceRoot, req.SourcePath)
	if err != nil {
		return err
	}
	info, err := os.Lstat(source.Actual.Abs)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("请选择普通压缩文件，不支持符号链接")
	}
	if req.Name == "" {
		parent, err := s.Roots.ResolveFollow(req.DestRoot, req.DestPath)
		if err != nil {
			return err
		}
		info, err := os.Stat(parent.Actual.Abs)
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return errors.New("目标位置不是文件夹")
		}
		return nil
	}
	_, err = s.Roots.ResolveCreate(req.DestRoot, filepath.Join(req.DestPath, req.Name))
	if errors.Is(err, roots.ErrPathExists) {
		return errors.New("目标已存在，不覆盖、不合并，请更换输出文件夹名称")
	}
	return err
}

// Open through an os.Root so symlink races cannot escape configured roots.
func (s Service) openSource(req Request) (*os.File, error) {
	resolved, err := s.Roots.ResolveEntry(req.SourceRoot, req.SourcePath)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(resolved.Actual.Root.Path)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	f, err := root.OpenFile(resolved.Actual.Rel, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, errors.New("压缩包不是普通文件")
	}
	return f, nil
}

func (s Service) createOutput(req Request) (*os.Root, error) {
	resolved, err := s.Roots.ResolveFollow(req.DestRoot, req.DestPath)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(resolved.Actual.Root.Path)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	parent, err := root.OpenRoot(resolved.Actual.Rel)
	if err != nil {
		return nil, err
	}
	if req.Name == "" {
		return parent, nil
	}
	defer parent.Close()
	if err := parent.Mkdir(req.Name, 0755); err != nil {
		return nil, fmt.Errorf("无法新建输出目录（不覆盖已有目录）：%w", err)
	}
	info, err := parent.Lstat(req.Name)
	if err != nil || !info.IsDir() {
		return nil, errors.New("输出目录在创建后发生变化；可能保留部分解压文件")
	}
	out, err := parent.OpenRoot(req.Name)
	if err != nil {
		return nil, err
	}
	actual, err := out.Stat(".")
	if err != nil || !os.SameFile(info, actual) {
		out.Close()
		return nil, errors.New("输出目录在打开时发生变化；可能保留部分解压文件")
	}
	return out, nil
}

type streamWriter struct {
	ctx       context.Context
	file      *os.File
	remaining int64
	progress  *jobs.TransferProgress
}

func (w *streamWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	if int64(len(p)) > w.remaining {
		return 0, errors.New("实际解压大小超过条目声明大小，已停止")
	}
	n, err := w.file.Write(p)
	w.remaining -= int64(n)
	w.progress.BytesDone += int64(n)
	if err == nil {
		err = jobs.Report(w.ctx, *w.progress)
	}
	return n, err
}

func writeEntry(ctx context.Context, out *os.Root, item entry, progress *jobs.TransferProgress, read func(io.Writer) error) error {
	if err := safeName(item.name); err != nil {
		return err
	}
	if item.directory {
		dir, err := openOutputDirectory(out, item.name)
		if err != nil {
			return err
		}
		return dir.Close()
	}
	parent, err := openOutputDirectory(out, path.Dir(item.name))
	if err != nil {
		return err
	}
	defer parent.Close()
	f, err := parent.OpenFile(path.Base(item.name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	progress.File = item.name
	if err := jobs.Report(ctx, *progress); err != nil {
		return err
	}
	w := &streamWriter{ctx: ctx, file: f, remaining: item.size, progress: progress}
	if err := read(w); err != nil {
		return err
	}
	if w.remaining != 0 {
		return errors.New("解压文件大小与条目声明不一致")
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	done := *progress.FilesDone + 1
	progress.FilesDone = &done
	return jobs.Report(ctx, *progress)
}

func (s Service) Execute(ctx context.Context, req Request) (err error) {
	if err := s.Validate(req); err != nil {
		return err
	}
	source, err := s.openSource(req)
	if err != nil {
		return err
	}
	defer source.Close()
	before, err := source.Stat()
	if err != nil {
		return err
	}
	tool, err := findTool()
	if err != nil {
		return err
	}
	d := decoder{tool: tool, source: source, password: req.Password}
	progress := jobs.TransferProgress{Scope: "local-extract", Phase: "scan", File: filepath.Base(req.SourcePath), Cancelable: true}
	if err := jobs.Report(ctx, progress); err != nil {
		return err
	}
	// Probe the decoder sandbox even for tar decoded in-process, providing one
	// consistent, explicit dependency boundary across supported formats.
	if err := d.run(ctx, io.Discard, "i"); err != nil {
		return err
	}
	var items []entry
	isTar := tarFormat(req.SourcePath)
	if isTar {
		err = walkTar(ctx, d, req.SourcePath, func(item entry, _ io.Reader) error {
			items = append(items, item)
			if len(items) > maxEntries {
				return errors.New("压缩包条目过多")
			}
			return nil
		})
	} else {
		items, err = d.list(ctx)
	}
	if err != nil {
		return err
	}
	total, err := validateEntries(items)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	current, err := source.Stat()
	if err != nil || current.Size() != before.Size() || !current.ModTime().Equal(before.ModTime()) {
		return errors.New("压缩包在扫描期间发生变化")
	}
	out, err := s.createOutput(req)
	if err != nil {
		return err
	}
	defer out.Close()
	if req.Name == "" {
		if err := checkOutputConflicts(ctx, out, items); err != nil {
			return err
		}
	}
	defer func() {
		if err != nil {
			err = fmt.Errorf("%w；可能保留部分解压文件：%s", err, filepath.ToSlash(filepath.Join(req.DestPath, req.Name)))
		}
	}()
	files, done := 0, 0
	for _, item := range items {
		if !item.directory {
			files++
		}
	}
	progress.Phase, progress.BytesTotal, progress.FilesDone, progress.FilesTotal = "extract", total, &done, &files
	if err := jobs.Report(ctx, progress); err != nil {
		return err
	}
	if isTar {
		index := 0
		err = walkTar(ctx, d, req.SourcePath, func(item entry, contents io.Reader) error {
			if index >= len(items) || item != items[index] {
				return errors.New("压缩包目录发生变化")
			}
			index++
			return writeEntry(ctx, out, item, &progress, func(w io.Writer) error { _, err := io.Copy(w, contents); return err })
		})
		if err == nil && index != len(items) {
			err = errors.New("压缩包条目数量发生变化")
		}
	} else {
		for _, item := range items {
			if err = ctx.Err(); err != nil {
				break
			}
			err = writeEntry(ctx, out, item, &progress, func(w io.Writer) error { return d.extract(ctx, item, w) })
			if err != nil {
				break
			}
		}
	}
	return err
}

func tarFormat(name string) bool {
	name = strings.ToLower(name)
	for _, suffix := range []string{".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz"} {
		if strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return false
}

// Tar is scanned and then streamed directly, without an intermediate .tar file.
// The scan necessarily decodes compressed tar data to inspect subsequent headers.
func walkTar(ctx context.Context, d decoder, name string, visit func(entry, io.Reader) error) error {
	source := d.source
	if _, err := source.Seek(0, io.SeekStart); err != nil {
		return err
	}
	var reader io.Reader = source
	name = strings.ToLower(name)
	if strings.HasSuffix(name, ".gz") || strings.HasSuffix(name, ".tgz") {
		gz, err := gzip.NewReader(source)
		if err != nil {
			return err
		}
		defer gz.Close()
		reader = gz
	} else if strings.HasSuffix(name, ".bz2") || strings.HasSuffix(name, ".tbz2") {
		reader = bzip2.NewReader(source)
	} else if strings.HasSuffix(name, ".xz") || strings.HasSuffix(name, ".txz") {
		streamCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		pipe, writer := io.Pipe()
		defer pipe.Close()
		done := make(chan error, 1)
		go func() {
			err := d.run(streamCtx, writer, "x", "-so", "-bso0", "-txz")
			_ = writer.CloseWithError(err)
			done <- err
		}()
		err := walkTarReader(ctx, pipe, visit)
		cancel()
		_ = pipe.Close()
		decodeErr := <-done
		if err != nil {
			return err
		}
		return decodeErr
	}
	return walkTarReader(ctx, reader, visit)
}

func walkTarReader(ctx context.Context, reader io.Reader, visit func(entry, io.Reader) error) error {
	stream := &contextReader{ctx: ctx, reader: io.LimitReader(reader, maxBytes+(maxEntries*1024)+1)}
	tr := tar.NewReader(stream)
	var total int64
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			// Drain to verify compressed stream checksums and reap a piped decoder.
			_, err = io.Copy(io.Discard, stream)
			return err
		}
		if err != nil {
			return err
		}
		if h.Typeflag != tar.TypeDir && h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA {
			return errors.New("不支持压缩包中的链接或特殊条目：" + h.Name)
		}
		name := strings.TrimSuffix(h.Name, "/")
		// Normal tar tools commonly prefix entries with ./.
		name = strings.TrimPrefix(name, "./")
		if name == "." || name == "" {
			if h.Typeflag == tar.TypeDir {
				continue
			}
		}
		item := entry{name: name, size: h.Size, directory: h.Typeflag == tar.TypeDir}
		if err := safeName(name); err != nil {
			return err
		}
		if item.size < 0 || item.size > maxBytes {
			return errors.New("压缩包条目大小超过限制")
		}
		if item.size > maxBytes-total {
			return errors.New("解压大小超过 8 TiB 限制")
		}
		total += item.size
		if err := visit(item, tr); err != nil {
			return err
		}
	}
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
