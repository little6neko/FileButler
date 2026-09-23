package superrename

import (
	"context"
	"errors"
	"fmt"
	"github.com/little6neko/filebutler/internal/storage"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/little6neko/filebutler/internal/roots"
)

var ErrExecutionStale = errors.New("superrename_execution_stale")

type GroupExecutor interface {
	ExecuteGroup(ctx context.Context, jobID string, rootID string, group PlanGroup) error
}

type Executor struct {
	Cache         *storage.Store
	Resolver      roots.Resolver
	Now           func() time.Time
	fileSystem    executorFileSystem
	writeManifest func(string, recoveryManifest) error
}

type executorFileSystem interface {
	Lstat(name string) (os.FileInfo, error)
	MkdirTemp(dir string, pattern string) (string, error)
	Mkdir(name string, permission os.FileMode) error
	Rename(oldPath string, newPath string) error
	Remove(name string) error
}

type osExecutorFileSystem struct{}

func (osExecutorFileSystem) Lstat(name string) (os.FileInfo, error) {
	return os.Lstat(name)
}

func (osExecutorFileSystem) MkdirTemp(directory string, pattern string) (string, error) {
	return os.MkdirTemp(directory, pattern)
}

func (osExecutorFileSystem) Mkdir(name string, permission os.FileMode) error {
	return os.Mkdir(name, permission)
}

func (osExecutorFileSystem) Rename(oldPath string, newPath string) error {
	return os.Rename(oldPath, newPath)
}

func (osExecutorFileSystem) Remove(name string) error {
	return os.Remove(name)
}

type executionItem struct {
	plan      PlanItem
	sourceAbs string
	targetAbs string
	stageAbs  string
	stagePath string
	staged    bool
	finalized bool
}

func (e Executor) ExecuteGroup(ctx context.Context, jobID string, rootID string, group PlanGroup) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if group.HasConflict {
		return ErrPlanConflict
	}
	for _, item := range group.Items {
		if item.Conflict {
			return ErrPlanConflict
		}
	}

	fs := e.fs()
	groupResolved, err := e.Resolver.ResolveEntry(rootID, group.Path)
	if err != nil {
		return err
	}
	groupInfo, err := fs.Lstat(groupResolved.Actual.Abs)
	e.Cache.InvalidateLocal(groupResolved.Actual.Root.ID, groupResolved.Actual.Root.Path, groupResolved.Actual.Rel)
	defer e.Cache.InvalidateLocal(groupResolved.Actual.Root.ID, groupResolved.Actual.Root.Path, groupResolved.Actual.Rel)
	if err != nil {
		return err
	}
	if groupInfo.Mode()&os.ModeSymlink != 0 || !groupInfo.IsDir() {
		return ErrExecutionStale
	}

	items, videoAbs, err := e.prepareItems(rootID, group, groupResolved.Actual.Abs, fs)
	if err != nil {
		return err
	}
	changed := make([]executionItem, 0, len(items))
	for _, item := range items {
		if item.plan.Changed {
			changed = append(changed, item)
		}
	}
	if len(changed) == 0 {
		return nil
	}

	stageDirectory, err := fs.MkdirTemp(groupResolved.Actual.Abs, recoveryPrefix+sanitizeJobID(jobID)+"-*")
	if err != nil {
		return err
	}
	stageFiles := filepath.Join(stageDirectory, "files")
	manifestPath := filepath.Join(stageDirectory, "manifest.json")
	if err := fs.Mkdir(stageFiles, 0o700); err != nil {
		cleanupErr := cleanupStage(fs, stageDirectory, stageFiles, manifestPath)
		return errors.Join(err, cleanupErr)
	}

	stageBase := filepath.Base(stageDirectory)
	stageRelative := joinRelative(group.Path, stageBase)
	manifest := recoveryManifest{
		Version:       recoveryManifestVersion,
		JobID:         jobID,
		RootID:        rootID,
		GroupPath:     group.Path,
		Phase:         "staging",
		CreatedAtUnix: e.now().Unix(),
		Items:         make([]recoveryManifestItem, len(changed)),
	}
	for index := range changed {
		changed[index].stageAbs = filepath.Join(stageFiles, fmt.Sprintf("%06d", index+1))
		changed[index].stagePath = joinRelative(group.Path, stageBase, "files", fmt.Sprintf("%06d", index+1))
		manifest.Items[index] = recoveryManifestItem{
			SourcePath: changed[index].plan.SourcePath,
			StagePath:  changed[index].stagePath,
			TargetPath: changed[index].plan.TargetPath,
		}
	}
	writeManifest := e.manifestWriter()
	if err := writeManifest(manifestPath, manifest); err != nil {
		cleanupErr := cleanupStage(fs, stageDirectory, stageFiles, manifestPath)
		return errors.Join(err, cleanupErr)
	}

	operationErr := stageSources(fs, changed)
	createdVideoDirectory := false
	if operationErr == nil {
		manifest.Phase = "staged"
		operationErr = writeManifest(manifestPath, manifest)
	}
	if operationErr == nil && group.CreateVideoDirectory {
		operationErr = fs.Mkdir(videoAbs, 0o755)
		createdVideoDirectory = operationErr == nil
	}
	if operationErr == nil {
		manifest.Phase = "finalizing"
		operationErr = writeManifest(manifestPath, manifest)
	}
	if operationErr == nil {
		operationErr = finalizeTargets(fs, changed)
	}
	if operationErr != nil {
		return e.rollbackFailure(fs, writeManifest, manifestPath, stageDirectory, stageRelative, stageFiles, videoAbs, createdVideoDirectory, manifest, changed, operationErr)
	}

	manifest.Phase = "complete"
	if err := writeManifest(manifestPath, manifest); err != nil {
		return &RecoveryRequiredError{StagePath: stageRelative, Cause: err, Recovery: errors.New("all file operations completed; remove the staging directory manually")}
	}
	if err := cleanupStage(fs, stageDirectory, stageFiles, manifestPath); err != nil {
		return &RecoveryRequiredError{StagePath: stageRelative, Cause: err, Recovery: errors.New("all file operations completed; remove the staging directory manually")}
	}
	return nil
}

func (e Executor) prepareItems(rootID string, group PlanGroup, groupAbs string, fs executorFileSystem) ([]executionItem, string, error) {
	cleanGroup := path.Clean(group.Path)
	if cleanGroup == "." || cleanGroup == "" || path.IsAbs(cleanGroup) || cleanGroup != group.Path {
		return nil, "", fmt.Errorf("%w: invalid group path", ErrExecutionStale)
	}
	videoPath := joinRelative(group.Path, videoDirectoryName)
	videoResolved, err := resolveExistingOrCreate(e.Resolver, rootID, videoPath)
	if err != nil {
		return nil, "", err
	}

	items := make([]executionItem, 0, len(group.Items))
	sources := make(map[string]struct{}, len(group.Items))
	targets := make(map[string]struct{}, len(group.Items))
	changedSources := make(map[string]struct{}, len(group.Items))
	hasVideo := false
	for _, item := range group.Items {
		if item.SourcePath == "" || item.TargetPath == "" || path.IsAbs(item.SourcePath) || path.IsAbs(item.TargetPath) {
			return nil, "", fmt.Errorf("%w: invalid item path", ErrExecutionStale)
		}
		if path.Clean(item.SourcePath) != item.SourcePath || path.Dir(item.SourcePath) != group.Path {
			return nil, "", fmt.Errorf("%w: source is not a direct group file", ErrExecutionStale)
		}
		expectedTargetParent := group.Path
		switch item.MediaKind {
		case MediaKindImage:
		case MediaKindVideo:
			hasVideo = true
			expectedTargetParent = videoPath
		default:
			return nil, "", fmt.Errorf("%w: invalid media kind", ErrExecutionStale)
		}
		if path.Clean(item.TargetPath) != item.TargetPath || path.Dir(item.TargetPath) != expectedTargetParent {
			return nil, "", fmt.Errorf("%w: target is outside its media destination", ErrExecutionStale)
		}
		if item.Changed != (item.SourcePath != item.TargetPath) {
			return nil, "", fmt.Errorf("%w: changed flag does not match item paths", ErrExecutionStale)
		}
		if _, duplicate := sources[item.SourcePath]; duplicate {
			return nil, "", fmt.Errorf("%w: duplicate source", ErrExecutionStale)
		}
		if _, duplicate := targets[item.TargetPath]; duplicate {
			return nil, "", fmt.Errorf("%w: duplicate target", ErrExecutionStale)
		}
		sources[item.SourcePath] = struct{}{}
		targets[item.TargetPath] = struct{}{}
		if item.Changed {
			changedSources[item.SourcePath] = struct{}{}
		}

		sourceResolved, err := e.Resolver.ResolveEntry(rootID, item.SourcePath)
		if err != nil {
			return nil, "", err
		}
		var targetAbs string
		targetResolved, targetErr := resolveExistingOrCreate(e.Resolver, rootID, item.TargetPath)
		if targetErr == nil {
			targetAbs = targetResolved.Actual.Abs
		} else if item.MediaKind == MediaKindVideo && group.CreateVideoDirectory && os.IsNotExist(targetErr) {
			targetAbs = filepath.Join(videoResolved.Actual.Abs, path.Base(item.TargetPath))
			if _, mapErr := e.Resolver.MapPath(targetAbs); mapErr != nil {
				return nil, "", mapErr
			}
		} else {
			return nil, "", targetErr
		}
		if filepath.Clean(filepath.Dir(sourceResolved.Actual.Abs)) != filepath.Clean(groupAbs) {
			return nil, "", fmt.Errorf("%w: resolved source is outside group", ErrExecutionStale)
		}
		info, err := fs.Lstat(sourceResolved.Actual.Abs)
		if err != nil {
			return nil, "", fmt.Errorf("%w: source %s: %v", ErrExecutionStale, item.SourcePath, err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return nil, "", fmt.Errorf("%w: source is not a regular file", ErrExecutionStale)
		}
		items = append(items, executionItem{plan: item, sourceAbs: sourceResolved.Actual.Abs, targetAbs: targetAbs})
	}
	if group.CreateVideoDirectory && !hasVideo {
		return nil, "", fmt.Errorf("%w: video directory requested without selected videos", ErrExecutionStale)
	}

	if hasVideo {
		videoInfo, err := fs.Lstat(videoResolved.Actual.Abs)
		switch {
		case os.IsNotExist(err) && group.CreateVideoDirectory:
		case os.IsNotExist(err):
			return nil, "", fmt.Errorf("%w: video directory disappeared", ErrExecutionStale)
		case err != nil:
			return nil, "", err
		case group.CreateVideoDirectory:
			return nil, "", fmt.Errorf("%w: video directory appeared after planning", ErrExecutionStale)
		case videoInfo.Mode()&os.ModeSymlink != 0 || !videoInfo.IsDir():
			return nil, "", fmt.Errorf("%w: video path is not a directory", ErrExecutionStale)
		}
	}

	for _, item := range items {
		if !item.plan.Changed {
			continue
		}
		_, err := fs.Lstat(item.targetAbs)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, "", err
		}
		if _, vacates := changedSources[item.plan.TargetPath]; !vacates {
			return nil, "", fmt.Errorf("%w: target %s is occupied", ErrExecutionStale, item.plan.TargetPath)
		}
	}
	return items, videoResolved.Actual.Abs, nil
}

func resolveExistingOrCreate(resolver roots.Resolver, rootID string, rel string) (roots.MappedPath, error) {
	resolved, err := resolver.ResolveEntry(rootID, rel)
	if err == nil || !os.IsNotExist(err) {
		return resolved, err
	}
	return resolver.ResolveCreate(rootID, rel)
}

func stageSources(fs executorFileSystem, items []executionItem) error {
	for index := range items {
		if err := fs.Rename(items[index].sourceAbs, items[index].stageAbs); err != nil {
			return err
		}
		items[index].staged = true
	}
	return nil
}

func finalizeTargets(fs executorFileSystem, items []executionItem) error {
	for index := range items {
		if err := fs.Rename(items[index].stageAbs, items[index].targetAbs); err != nil {
			return err
		}
		items[index].finalized = true
	}
	return nil
}

func (e Executor) rollbackFailure(
	fs executorFileSystem,
	writeManifest func(string, recoveryManifest) error,
	manifestPath string,
	stageDirectory string,
	stageRelative string,
	stageFiles string,
	videoAbs string,
	createdVideoDirectory bool,
	manifest recoveryManifest,
	items []executionItem,
	operationErr error,
) error {
	manifest.Phase = "rolling-back"
	manifestErr := writeManifest(manifestPath, manifest)
	rollbackErr := rollbackItems(fs, items)
	if createdVideoDirectory {
		rollbackErr = errors.Join(rollbackErr, fs.Remove(videoAbs))
	}
	rollbackErr = errors.Join(manifestErr, rollbackErr)
	if rollbackErr == nil {
		if cleanupErr := cleanupStage(fs, stageDirectory, stageFiles, manifestPath); cleanupErr == nil {
			return operationErr
		} else {
			rollbackErr = cleanupErr
		}
	}
	manifest.Phase = "rollback-failed"
	_ = writeManifest(manifestPath, manifest)
	return &RecoveryRequiredError{
		StagePath: stageRelative,
		Cause:     operationErr,
		Recovery:  rollbackErr,
	}
}

func rollbackItems(fs executorFileSystem, items []executionItem) error {
	var rollbackErr error
	for index := range items {
		if !items[index].finalized {
			continue
		}
		if err := fs.Rename(items[index].targetAbs, items[index].stageAbs); err != nil {
			rollbackErr = errors.Join(rollbackErr, fmt.Errorf("return target %s to stage: %w", items[index].plan.TargetPath, err))
			continue
		}
		items[index].finalized = false
	}
	for index := range items {
		if !items[index].staged || items[index].finalized {
			continue
		}
		if err := fs.Rename(items[index].stageAbs, items[index].sourceAbs); err != nil {
			rollbackErr = errors.Join(rollbackErr, fmt.Errorf("restore source %s: %w", items[index].plan.SourcePath, err))
			continue
		}
		items[index].staged = false
	}
	return rollbackErr
}

func cleanupStage(fs executorFileSystem, stageDirectory string, stageFiles string, manifestPath string) error {
	if err := fs.Remove(stageFiles); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := fs.Remove(manifestPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := fs.Remove(stageDirectory); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func sanitizeJobID(jobID string) string {
	var builder strings.Builder
	for _, character := range jobID {
		if unicode.IsLetter(character) || unicode.IsDigit(character) || character == '-' || character == '_' {
			builder.WriteRune(character)
		}
		if builder.Len() >= 48 {
			break
		}
	}
	if builder.Len() == 0 {
		return "job"
	}
	return builder.String()
}

func (e Executor) fs() executorFileSystem {
	if e.fileSystem != nil {
		return e.fileSystem
	}
	return osExecutorFileSystem{}
}

func (e Executor) manifestWriter() func(string, recoveryManifest) error {
	if e.writeManifest != nil {
		return e.writeManifest
	}
	return writeManifestAtomic
}

func (e Executor) now() time.Time {
	if e.Now != nil {
		return e.Now().UTC()
	}
	return time.Now().UTC()
}
