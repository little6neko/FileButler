package roots

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

const maxSymlinkExpansions = 40

type PathLocation struct {
	Root Root
	Rel  string
	Abs  string
}

type MappedPath struct {
	Requested PathLocation
	Actual    PathLocation
}

type mappedRoot struct {
	root      Root
	canonical string
	err       error
}

// MapPath maps an absolute path to the most specific configured canonical root.
// It performs no filesystem access and therefore is safe to use before probing a
// path reached through a symlink.
func (r Resolver) MapPath(abs string) (PathLocation, error) {
	if !filepath.IsAbs(abs) {
		return PathLocation{}, ErrInvalidPath
	}
	abs = filepath.Clean(abs)
	for _, candidate := range r.mapped {
		if candidate.err != nil || !inside(candidate.canonical, abs) {
			continue
		}
		rel, err := filepath.Rel(candidate.canonical, abs)
		if err != nil {
			return PathLocation{}, err
		}
		return PathLocation{
			Root: candidate.root,
			Rel:  filepath.Clean(rel),
			Abs:  abs,
		}, nil
	}
	return PathLocation{}, ErrOutsideRoot
}

// ResolveFollow follows every path component, including a final symlink, and
// returns both the user's lexical request and the actual mapped location.
func (r Resolver) ResolveFollow(rootID string, rel string) (MappedPath, error) {
	requested, err := r.requestedLocation(rootID, rel)
	if err != nil {
		return MappedPath{}, err
	}
	root, err := r.canonicalRoot(rootID)
	if err != nil {
		return MappedPath{}, err
	}
	actual, err := r.followFrom(root.canonical, requested.Rel)
	if err != nil {
		return MappedPath{}, err
	}
	return MappedPath{Requested: requested, Actual: actual}, nil
}

// ResolveEntry follows the parent directory but deliberately does not follow
// the final directory entry. The final entry must exist.
func (r Resolver) ResolveEntry(rootID string, rel string) (MappedPath, error) {
	return r.resolveFinalEntry(rootID, rel, false)
}

// ResolveCreate follows the parent directory and returns an unused final path.
// The parent must be an existing real directory and the final entry must not
// already exist, including a broken symlink.
func (r Resolver) ResolveCreate(rootID string, rel string) (MappedPath, error) {
	return r.resolveFinalEntry(rootID, rel, true)
}

func (r Resolver) resolveFinalEntry(rootID string, rel string, create bool) (MappedPath, error) {
	requested, err := r.requestedLocation(rootID, rel)
	if err != nil {
		return MappedPath{}, err
	}
	if requested.Rel == "." {
		return MappedPath{}, ErrInvalidPath
	}

	parentRel := filepath.Dir(requested.Rel)
	name := filepath.Base(requested.Rel)
	parent, err := r.ResolveFollow(rootID, parentRel)
	if err != nil {
		return MappedPath{}, err
	}
	parentInfo, err := r.safeLstat(parent.Actual.Abs)
	if err != nil {
		return MappedPath{}, err
	}
	if !parentInfo.IsDir() {
		return MappedPath{}, &os.PathError{Op: "resolve parent", Path: parent.Actual.Abs, Err: syscall.ENOTDIR}
	}

	finalAbs := filepath.Join(parent.Actual.Abs, name)
	actual, err := r.MapPath(finalAbs)
	if err != nil {
		return MappedPath{}, err
	}
	_, statErr := r.lstat(finalAbs)
	if create {
		switch {
		case statErr == nil:
			return MappedPath{}, ErrPathExists
		case errors.Is(statErr, os.ErrNotExist):
			return MappedPath{Requested: requested, Actual: actual}, nil
		default:
			return MappedPath{}, statErr
		}
	}
	if statErr != nil {
		return MappedPath{}, statErr
	}
	return MappedPath{Requested: requested, Actual: actual}, nil
}

func (r Resolver) requestedLocation(rootID string, rel string) (PathLocation, error) {
	resolved, err := r.Resolve(rootID, rel)
	if err != nil {
		return PathLocation{}, err
	}
	return PathLocation{Root: resolved.Root, Rel: resolved.Rel, Abs: resolved.Abs}, nil
}

func (r Resolver) canonicalRoot(rootID string) (mappedRoot, error) {
	if _, ok := r.roots[rootID]; !ok {
		return mappedRoot{}, ErrUnknownRoot
	}
	for _, root := range r.mapped {
		if root.root.ID != rootID {
			continue
		}
		if root.err != nil {
			return mappedRoot{}, root.err
		}
		return root, nil
	}
	return mappedRoot{}, ErrUnknownRoot
}

func (r Resolver) followFrom(canonicalRoot string, rel string) (PathLocation, error) {
	current := filepath.Clean(canonicalRoot)
	remaining := splitRelative(rel)
	expansions := 0

	if len(remaining) == 0 {
		if _, err := r.safeLstat(current); err != nil {
			return PathLocation{}, err
		}
		return r.MapPath(current)
	}

	for len(remaining) > 0 {
		name := remaining[0]
		remaining = remaining[1:]
		candidate := filepath.Join(current, name)
		info, err := r.safeLstat(candidate)
		if err != nil {
			return PathLocation{}, err
		}
		if info.Mode()&os.ModeSymlink == 0 {
			if len(remaining) > 0 && !info.IsDir() {
				return PathLocation{}, &os.PathError{Op: "resolve", Path: candidate, Err: syscall.ENOTDIR}
			}
			current = candidate
			continue
		}

		expansions++
		if expansions > maxSymlinkExpansions {
			return PathLocation{}, ErrSymlinkLoop
		}
		target, err := r.readlink(candidate)
		if err != nil {
			return PathLocation{}, err
		}
		if !filepath.IsAbs(target) {
			target = filepath.Join(current, target)
		}
		target = filepath.Clean(target)
		mappedTarget, err := r.mapAllowedTarget(target)
		if err != nil {
			return PathLocation{}, err
		}
		mappedRoot, err := r.canonicalRoot(mappedTarget.Root.ID)
		if err != nil {
			return PathLocation{}, err
		}
		current = mappedRoot.canonical
		remaining = append(splitRelative(mappedTarget.Rel), remaining...)
	}

	return r.MapPath(current)
}

func (r Resolver) safeLstat(path string) (os.FileInfo, error) {
	if _, err := r.MapPath(path); err != nil {
		return nil, err
	}
	return r.lstat(path)
}

// mapAllowedTarget accepts canonical mapped paths and the configured lexical
// root aliases. Lexical aliases are converted to their canonical root before a
// caller performs any filesystem access.
func (r Resolver) mapAllowedTarget(abs string) (PathLocation, error) {
	if location, err := r.MapPath(abs); err == nil {
		return location, nil
	} else if !errors.Is(err, ErrOutsideRoot) {
		return PathLocation{}, err
	}

	var selected *mappedRoot
	for i := range r.mapped {
		candidate := &r.mapped[i]
		if candidate.err != nil || !inside(candidate.root.Path, abs) {
			continue
		}
		if selected == nil || len(candidate.root.Path) > len(selected.root.Path) ||
			(len(candidate.root.Path) == len(selected.root.Path) && candidate.root.ID < selected.root.ID) {
			selected = candidate
		}
	}
	if selected == nil {
		return PathLocation{}, ErrOutsideRoot
	}
	rel, err := filepath.Rel(selected.root.Path, abs)
	if err != nil {
		return PathLocation{}, err
	}
	return r.MapPath(filepath.Join(selected.canonical, rel))
}

func splitRelative(rel string) []string {
	rel = filepath.Clean(rel)
	if rel == "." {
		return nil
	}
	return strings.Split(rel, string(os.PathSeparator))
}
