package extract

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode"
)

const maxEntries = 100000
const maxBytes int64 = 8 << 40

type entry struct {
	name      string
	size      int64
	directory bool
}

func safeName(name string) error {
	if name == "" || len(name) > 4096 || strings.ContainsAny(name, "\\:") || strings.HasPrefix(name, "/") || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return errors.New("压缩包含不安全或无法识别的路径")
	}
	for _, part := range strings.Split(name, "/") {
		if part == ".." || part == "." || part == "" {
			return errors.New("压缩包含不安全路径：" + name)
		}
	}
	return nil
}

func validateEntries(items []entry) (int64, error) {
	if len(items) > maxEntries {
		return 0, errors.New("压缩包条目超过 100000 项限制")
	}
	seen := map[string]bool{}
	var total int64
	for _, item := range items {
		if err := safeName(item.name); err != nil {
			return 0, err
		}
		if _, exists := seen[item.name]; exists {
			return 0, errors.New("压缩包包含重复路径：" + item.name)
		}
		seen[item.name] = item.directory
		if item.size < 0 || item.size > maxBytes-total {
			return 0, errors.New("解压大小超过 8 TiB 限制")
		}
		total += item.size
	}
	for _, item := range items {
		for parent := path.Dir(item.name); parent != "."; parent = path.Dir(parent) {
			if directory, exists := seen[parent]; exists && !directory {
				return 0, errors.New("压缩包文件与目录路径冲突：" + parent)
			}
		}
	}
	return total, nil
}

// Technical listing is deliberately strict. Control characters, links and
// special Unix file types are not supported. Only listed, individually selected
// streams will ever be written; the decoder never chooses an output path.
func parseListing(data []byte) ([]entry, error) {
	var items []entry
	fields := map[string]string{}
	flush := func() error {
		if len(fields) == 0 {
			return nil
		}
		name, ok := fields["Path"]
		if !ok {
			return errors.New("无法识别压缩包条目信息")
		}
		for _, key := range []string{"Symbolic Link", "Hard Link", "Alternate Stream"} {
			if fields[key] != "" && fields[key] != "-" {
				return errors.New("不支持压缩包中的链接或特殊条目：" + name)
			}
		}
		attrs := strings.Fields(fields["Attributes"])
		for _, attr := range attrs {
			if len(attr) >= 10 && strings.ContainsAny(attr[:1], "lbcps") {
				return errors.New("不支持压缩包中的链接或特殊条目：" + name)
			}
		}
		dir := fields["Folder"] == "+" || strings.HasPrefix(fields["Attributes"], "D") || strings.HasPrefix(fields["Attributes"], "d")
		size, err := strconv.ParseInt(fields["Size"], 10, 64)
		if err != nil && !dir {
			return errors.New("无法识别压缩包文件大小：" + name)
		}
		if dir {
			size = 0
		}
		items = append(items, entry{name: strings.TrimSuffix(name, "/"), size: size, directory: dir})
		fields = map[string]string{}
		if len(items) > maxEntries {
			return errors.New("压缩包条目过多")
		}
		return nil
	}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 4096), 16384)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := flush(); err != nil {
				return nil, err
			}
			continue
		}
		// Password prompts may precede the first field when headers are encrypted.
		line = strings.TrimPrefix(line, "Enter password (will not be echoed):")
		line = strings.TrimPrefix(line, "Enter password:")
		if strings.TrimSpace(line) == "" {
			continue
		}
		key, value, ok := strings.Cut(line, " = ")
		if !ok {
			return nil, errors.New("压缩包目录信息格式无效（可能包含特殊文件名）")
		}
		if _, duplicate := fields[key]; duplicate {
			return nil, errors.New("压缩包目录信息存在重复字段")
		}
		fields[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if err := flush(); err != nil {
		return nil, err
	}
	_, err := validateEntries(items)
	return items, err
}

type limitedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		return 0, errors.New("解压工具输出超过限制")
	}
	return b.Buffer.Write(p)
}

type decoder struct {
	tool     string
	source   *os.File
	password string
}

func findTool() (string, error) {
	for _, name := range []string{"7zz", "7z"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	return "", errors.New("本地解压需要安装 7-Zip（7zz 或 7z）")
}

func (d decoder) run(ctx context.Context, output io.Writer, args ...string) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	args = append(args, "-bd", "-y", "-sccUTF-8", "-spd", "-bse2", "-bsp0", "--", "/proc/self/fd/3")
	cmd := exec.CommandContext(ctx, executable, append([]string{helperArgument, d.tool}, args...)...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	cmd.ExtraFiles = []*os.File{d.source}
	cmd.Stdin = strings.NewReader(d.password + "\n")
	cmd.Stdout = output
	stderr := &limitedBuffer{limit: 16384}
	cmd.Stderr = stderr
	cmd.Env = append(os.Environ(), "LC_ALL=C.UTF-8")
	cmd.WaitDelay = 2 * time.Second
	err = cmd.Run()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if d.password != "" {
			message = strings.ReplaceAll(message, d.password, "[redacted]")
		}
		if message == "" {
			message = "密码错误、格式不支持或压缩包损坏"
		}
		return fmt.Errorf("7-Zip 解压失败：%s (%w)", message, err)
	}
	return nil
}

func (d decoder) list(ctx context.Context) ([]entry, error) {
	output := &limitedBuffer{limit: 32 << 20}
	if err := d.run(ctx, output, "l", "-slt", "-ba"); err != nil {
		return nil, err
	}
	return parseListing(output.Bytes())
}

func (d decoder) extract(ctx context.Context, item entry, output io.Writer) error {
	// -spd disables wildcard expansion; -i! selects a single exact entry. The
	// archive is fixed by fd, never reopened through an attacker-controlled path.
	return d.run(ctx, output, "x", "-so", "-bso0", "-i!"+item.name)
}
