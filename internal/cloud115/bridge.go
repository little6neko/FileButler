// Package cloud115 isolates the Python provider from HTTP and local file APIs.
package cloud115

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"

	"github.com/little6neko/filebutler/internal/jobs"
)

type Provider interface {
	Call(context.Context, string, any, jobs.Reporter) (json.RawMessage, error)
}

type message struct {
	ID       uint64                 `json:"id"`
	Ready    int                    `json:"ready,omitempty"`
	Data     json.RawMessage        `json:"data,omitempty"`
	Error    string                 `json:"error,omitempty"`
	Canceled bool                   `json:"canceled,omitempty"`
	Progress *jobs.TransferProgress `json:"progress,omitempty"`
}

type Bridge struct {
	mu                          sync.Mutex
	python, script, credentials string
	next                        uint64
	process                     *workerProcess
}
type workerProcess struct {
	cmd     *exec.Cmd
	in      io.WriteCloser
	pending map[uint64]chan message
}

func NewBridge(python, script, credentials string) *Bridge {
	return &Bridge{python: python, script: script, credentials: credentials}
}

func (b *Bridge) startLocked() error {
	if b.process != nil {
		return nil
	}
	cmd := exec.Command(b.python, "-u", b.script, "--credentials", b.credentials)
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		_ = in.Close()
		return err
	}
	// Provider exception text may contain cookies: never forward stderr to application logs.
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		_ = in.Close()
		return fmt.Errorf("115 worker unavailable: %w", err)
	}
	scanner := bufio.NewScanner(out)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	ready := make(chan bool, 1)
	go func() {
		if !scanner.Scan() {
			ready <- false
			return
		}
		var msg message
		ready <- json.Unmarshal(scanner.Bytes(), &msg) == nil && msg.Ready == 1
	}()
	select {
	case ok := <-ready:
		if !ok {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			return errors.New("115 worker protocol handshake failed")
		}
	case <-time.After(15 * time.Second):
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return errors.New("115 worker startup timed out")
	}
	p := &workerProcess{cmd: cmd, in: in, pending: make(map[uint64]chan message)}
	b.process = p
	go b.read(p, scanner)
	return nil
}

func (b *Bridge) read(p *workerProcess, scanner *bufio.Scanner) {
	for scanner.Scan() {
		var msg message
		if json.Unmarshal(scanner.Bytes(), &msg) != nil {
			break
		}
		b.mu.Lock()
		ch := p.pending[msg.ID]
		if ch != nil {
			select {
			case ch <- msg:
			default:
				_ = p.cmd.Process.Kill()
			}
		}
		b.mu.Unlock()
	}
	_ = p.in.Close()
	_ = p.cmd.Process.Kill()
	_ = p.cmd.Wait()
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, ch := range p.pending {
		close(ch)
	}
	if b.process == p {
		b.process = nil
	}
}

func (b *Bridge) Call(ctx context.Context, method string, params any, report jobs.Reporter) (json.RawMessage, error) {
	b.mu.Lock()
	if err := b.startLocked(); err != nil {
		b.mu.Unlock()
		return nil, err
	}
	p := b.process
	if len(p.pending) >= 64 {
		b.mu.Unlock()
		return nil, errors.New("115 worker is busy, try again later")
	}
	b.next++
	id := b.next
	ch := make(chan message, 8)
	p.pending[id] = ch
	err := json.NewEncoder(p.in).Encode(map[string]any{"id": id, "method": method, "params": params})
	b.mu.Unlock()
	defer func() { b.mu.Lock(); delete(p.pending, id); b.mu.Unlock() }()
	if err != nil {
		return nil, errors.New("115 worker write failed")
	}
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return nil, errors.New("115 worker stopped; operation outcome may be unknown, refresh before retrying")
			}
			if msg.Progress != nil {
				var reportErr error
				if report != nil {
					reportErr = report(*msg.Progress)
				}
				b.mu.Lock()
				err = json.NewEncoder(p.in).Encode(map[string]any{"id": id, "ack": true, "cancel": reportErr != nil})
				b.mu.Unlock()
				if err != nil {
					return nil, errors.New("115 progress acknowledgement failed")
				}
				continue
			}
			if msg.Canceled {
				return nil, context.Canceled
			}
			if msg.Error != "" {
				return nil, errors.New(msg.Error)
			}
			return msg.Data, nil
		}
	}
}

func (b *Bridge) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.process != nil {
		_ = b.process.in.Close()
		_ = b.process.cmd.Process.Kill()
	}
}
