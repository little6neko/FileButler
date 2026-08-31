package roots

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var (
	ErrUnknownRoot = errors.New("unknown_root")
	ErrOutsideRoot = errors.New("outside_root")
	ErrInvalidPath = errors.New("invalid_path")
	ErrSymlinkLoop = errors.New("symlink_loop")
	ErrPathExists  = errors.New("path_exists")
)

type Root struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path,omitempty"`
}

type ResolvedPath struct {
	Root         Root
	Rel          string
	Abs          string
	CanonicalAbs string
}

type Resolver struct {
	roots    map[string]Root
	mapped   []mappedRoot
	lstat    func(string) (os.FileInfo, error)
	readlink func(string) (string, error)
}

func NewResolver(input []Root) Resolver {
	items := make(map[string]Root, len(input))
	for _, root := range input {
		abs, err := filepath.Abs(root.Path)
		if err == nil {
			root.Path = filepath.Clean(abs)
		} else {
			root.Path = filepath.Clean(root.Path)
		}
		items[root.ID] = root
	}
	mapped := make([]mappedRoot, 0, len(items))
	for _, root := range items {
		canonical, err := filepath.EvalSymlinks(root.Path)
		if err == nil {
			canonical, err = filepath.Abs(canonical)
		}
		if err == nil {
			canonical = filepath.Clean(canonical)
		}
		mapped = append(mapped, mappedRoot{
			root:      root,
			canonical: canonical,
			err:       err,
		})
	}
	sort.Slice(mapped, func(i, j int) bool {
		if len(mapped[i].canonical) != len(mapped[j].canonical) {
			return len(mapped[i].canonical) > len(mapped[j].canonical)
		}
		return mapped[i].root.ID < mapped[j].root.ID
	})
	return Resolver{
		roots:    items,
		mapped:   mapped,
		lstat:    os.Lstat,
		readlink: os.Readlink,
	}
}

func (r Resolver) List() []Root {
	out := make([]Root, 0, len(r.roots))
	for _, root := range r.roots {
		out = append(out, root)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (r Resolver) Resolve(rootID string, rel string) (ResolvedPath, error) {
	root, ok := r.roots[rootID]
	if !ok {
		return ResolvedPath{}, ErrUnknownRoot
	}
	cleanRel, err := cleanRelative(rel)
	if err != nil {
		return ResolvedPath{}, err
	}
	abs := filepath.Clean(filepath.Join(root.Path, cleanRel))
	if !inside(root.Path, abs) {
		return ResolvedPath{}, fmt.Errorf("%w: %s", ErrOutsideRoot, rel)
	}
	return ResolvedPath{Root: root, Rel: cleanRel, Abs: abs}, nil
}

func (r Resolver) ResolveForWrite(rootID string, rel string) (ResolvedPath, error) {
	resolved, err := r.Resolve(rootID, rel)
	if err != nil {
		return ResolvedPath{}, err
	}
	rootEval, err := filepath.EvalSymlinks(resolved.Root.Path)
	if err != nil {
		return ResolvedPath{}, err
	}
	checkPath := resolved.Abs
	var suffix string
	for {
		eval, err := filepath.EvalSymlinks(checkPath)
		if err == nil {
			if !inside(rootEval, eval) {
				return ResolvedPath{}, fmt.Errorf("%w: %s", ErrOutsideRoot, rel)
			}
			canonical := eval
			if suffix != "" {
				canonical = filepath.Clean(filepath.Join(eval, suffix))
				if !inside(rootEval, canonical) {
					return ResolvedPath{}, fmt.Errorf("%w: %s", ErrOutsideRoot, rel)
				}
			}
			resolved.CanonicalAbs = canonical
			return resolved, nil
		}
		if !os.IsNotExist(err) {
			return ResolvedPath{}, err
		}
		parent := filepath.Dir(checkPath)
		if parent == checkPath || !inside(resolved.Root.Path, parent) {
			return ResolvedPath{}, fmt.Errorf("%w: %s", ErrOutsideRoot, rel)
		}
		name := filepath.Base(checkPath)
		if suffix == "" {
			suffix = name
		} else {
			suffix = filepath.Join(name, suffix)
		}
		checkPath = parent
	}
}

func cleanRelative(rel string) (string, error) {
	if rel == "" {
		rel = "."
	}
	if filepath.IsAbs(rel) {
		return "", ErrInvalidPath
	}
	cleaned := filepath.Clean(rel)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(os.PathSeparator)) {
		return "", ErrOutsideRoot
	}
	return cleaned, nil
}

func inside(root string, path string) bool {
	root = filepath.Clean(root)
	path = filepath.Clean(path)
	return path == root || strings.HasPrefix(path, root+string(os.PathSeparator))
}
