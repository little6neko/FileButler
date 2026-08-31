package links

import (
	"context"
	"errors"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type ExecutionHooks struct {
	BeforeStep func(PlanStep) error
	Report     func(PlanStep, error) error
}

type executorFileSystem interface {
	Lstat(string) (os.FileInfo, error)
	Readlink(string) (string, error)
	Mkdir(string, os.FileMode) error
	Link(string, string) error
	Symlink(string, string) error
	RenameNoReplace(string, string) error
	Chmod(string, os.FileMode) error
	Chtimes(string, time.Time, time.Time) error
}

type osExecutorFileSystem struct{}

func (osExecutorFileSystem) Lstat(path string) (os.FileInfo, error) {
	return os.Lstat(path)
}

func (osExecutorFileSystem) Readlink(path string) (string, error) {
	return os.Readlink(path)
}

func (osExecutorFileSystem) Mkdir(path string, mode os.FileMode) error {
	return os.Mkdir(path, mode)
}

func (osExecutorFileSystem) Link(source string, destination string) error {
	return os.Link(source, destination)
}

func (osExecutorFileSystem) Symlink(target string, path string) error {
	return os.Symlink(target, path)
}

func (osExecutorFileSystem) RenameNoReplace(source string, destination string) error {
	return renameNoReplace(source, destination)
}

func (osExecutorFileSystem) Chmod(path string, mode os.FileMode) error {
	return os.Chmod(path, mode)
}

func (osExecutorFileSystem) Chtimes(path string, accessTime time.Time, modifiedTime time.Time) error {
	return os.Chtimes(path, accessTime, modifiedTime)
}

type Executor struct {
	Planner    Planner
	Staging    StagingManager
	fileSystem executorFileSystem
}

func (executor Executor) ExecuteGroup(
	ctx context.Context,
	jobID string,
	group PlanGroup,
	hooks ExecutionHooks,
) (resultErr error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	if group.Conflict {
		return ErrPlanConflict
	}
	if err := executor.verifyCurrentPlan(ctx, group); err != nil {
		return err
	}
	area, err := executor.Staging.Create(group.DestParentAbs, jobID, group.DestName, group.PreviewRevision)
	if err != nil {
		return err
	}
	defer func() {
		cleanupErr := executor.Staging.Cleanup(area)
		if cleanupErr == nil {
			return
		}
		cause := resultErr
		if cause == nil {
			cause = ErrStagingCleanup
		}
		resultErr = &StagingCleanupError{Identifier: area.Identifier(), Cause: cause, Cleanup: cleanupErr}
	}()

	if isDirectoryClone(group) {
		return executor.executeDirectoryClone(ctx, group, area, hooks)
	}
	return executor.executeOrdinary(ctx, group, area, hooks)
}

func (executor Executor) executeOrdinary(
	ctx context.Context,
	group PlanGroup,
	area StagingArea,
	hooks ExecutionHooks,
) error {
	if len(group.Steps) != 1 {
		return ErrSourceChanged
	}
	step := group.Steps[0]
	if err := executor.beforeStep(ctx, hooks, step); err != nil {
		return err
	}
	if err := executor.verifyStepSource(group, step); err != nil {
		return executor.reportFailure(hooks, step, err)
	}
	fileSystem := executor.fs()
	var err error
	switch step.Action {
	case ActionHardlink:
		err = fileSystem.Link(group.SourceAbs, area.Payload)
	case ActionSymlink:
		err = fileSystem.Symlink(step.TargetText, area.Payload)
	default:
		err = ErrSourceChanged
	}
	if err != nil {
		return executor.reportFailure(hooks, step, err)
	}
	if err := executor.finishGroup(ctx, group, area, step, hooks); err != nil {
		return err
	}
	return nil
}

func (executor Executor) executeDirectoryClone(
	ctx context.Context,
	group PlanGroup,
	area StagingArea,
	hooks ExecutionHooks,
) error {
	directories, entries, rootStep, ok := orderedCloneSteps(group.Steps)
	if !ok {
		return ErrSourceChanged
	}
	fileSystem := executor.fs()
	for _, step := range directories {
		if err := executor.beforeStep(ctx, hooks, step); err != nil {
			return err
		}
		if err := executor.verifyStepSource(group, step); err != nil {
			return executor.reportFailure(hooks, step, err)
		}
		destination := clonePath(area.Payload, step.RelativePath)
		if err := fileSystem.Mkdir(destination, 0o700); err != nil {
			return executor.reportFailure(hooks, step, err)
		}
	}
	for _, step := range entries {
		if err := executor.beforeStep(ctx, hooks, step); err != nil {
			return err
		}
		if err := executor.verifyStepSource(group, step); err != nil {
			return executor.reportFailure(hooks, step, err)
		}
		source := clonePath(group.SourceAbs, step.RelativePath)
		destination := clonePath(area.Payload, step.RelativePath)
		var err error
		switch step.Action {
		case ActionHardlink:
			err = fileSystem.Link(source, destination)
		case ActionSymlink:
			err = fileSystem.Symlink(step.TargetText, destination)
		default:
			err = ErrSourceChanged
		}
		if err != nil {
			return executor.reportFailure(hooks, step, err)
		}
		if err := executor.report(hooks, step, nil); err != nil {
			return err
		}
	}

	for index := len(directories) - 1; index >= 0; index-- {
		step := directories[index]
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := executor.verifyStepSource(group, step); err != nil {
			return executor.reportFailure(hooks, step, err)
		}
		destination := clonePath(area.Payload, step.RelativePath)
		modifiedTime := time.Unix(0, step.ModifiedUnixNano)
		err := fileSystem.Chtimes(destination, modifiedTime, modifiedTime)
		if err == nil {
			err = fileSystem.Chmod(destination, step.Mode.Perm())
		}
		if err != nil {
			return executor.reportFailure(hooks, step, err)
		}
		if step.RelativePath != "." {
			if err := executor.report(hooks, step, nil); err != nil {
				return err
			}
		}
	}

	return executor.finishGroup(ctx, group, area, rootStep, hooks)
}

func (executor Executor) finishGroup(
	ctx context.Context,
	group PlanGroup,
	area StagingArea,
	pendingStep PlanStep,
	hooks ExecutionHooks,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := executor.verifyCurrentPlan(ctx, group); err != nil {
		return executor.reportFailure(hooks, pendingStep, err)
	}
	if group.Type == LinkSymlink {
		if err := executor.verifyOrdinarySymlinkTarget(group, pendingStep); err != nil {
			return executor.reportFailure(hooks, pendingStep, err)
		}
	}
	if err := executor.ensureTargetAbsent(group.DestAbs); err != nil {
		return executor.reportFailure(hooks, pendingStep, err)
	}
	if err := executor.fs().RenameNoReplace(area.Payload, group.DestAbs); err != nil {
		if _, statErr := executor.fs().Lstat(group.DestAbs); statErr == nil {
			err = errors.Join(ErrTargetExists, err)
		}
		return executor.reportFailure(hooks, pendingStep, err)
	}
	return executor.report(hooks, pendingStep, nil)
}

func (executor Executor) verifyCurrentPlan(ctx context.Context, expected PlanGroup) error {
	destinationParent := path.Dir(expected.DestPath)
	current, err := executor.Planner.Plan(ctx, Request{
		Type:       expected.Type,
		SourceRoot: expected.SourceRoot,
		Sources:    []string{expected.SourcePath},
		DestRoot:   expected.DestRoot,
		DestPath:   destinationParent,
	})
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return errors.Join(ErrSourceChanged, err)
	}
	if current.Preview.HasConflict {
		if len(current.Preview.Items) == 1 && current.Preview.Items[0].ErrorCode == ErrorTargetExists {
			return ErrTargetExists
		}
		return ErrSourceChanged
	}
	if len(current.Groups) != 1 || !sameGroupSnapshot(expected, current.Groups[0]) {
		return ErrSourceChanged
	}
	return nil
}

func sameGroupSnapshot(expected PlanGroup, actual PlanGroup) bool {
	if expected.Type != actual.Type || expected.SourceKind != actual.SourceKind ||
		expected.SourceIdentity != actual.SourceIdentity || expected.DestinationIdentity != actual.DestinationIdentity ||
		filepath.Clean(expected.SourceAbs) != filepath.Clean(actual.SourceAbs) ||
		filepath.Clean(expected.DestAbs) != filepath.Clean(actual.DestAbs) || len(expected.Steps) != len(actual.Steps) {
		return false
	}
	for index := range expected.Steps {
		if expected.Steps[index] != actual.Steps[index] {
			return false
		}
	}
	return true
}

func (executor Executor) verifyStepSource(group PlanGroup, step PlanStep) error {
	source := clonePath(group.SourceAbs, step.RelativePath)
	identity, err := executor.Planner.identityReader()(source, false)
	if err != nil || !identity.SameObject(step.SourceIdentity) {
		return ErrSourceChanged
	}
	info, err := executor.fs().Lstat(source)
	if err != nil {
		return ErrSourceChanged
	}
	switch step.Action {
	case ActionDirectory:
		if !info.IsDir() || info.Mode().Perm() != step.Mode.Perm() || info.ModTime().UnixNano() != step.ModifiedUnixNano {
			return ErrSourceChanged
		}
	case ActionHardlink:
		if !info.Mode().IsRegular() {
			return ErrSourceChanged
		}
	case ActionSymlink:
		if group.Type == LinkSymlink && step.RelativePath == "." {
			if !info.Mode().IsRegular() && !info.IsDir() {
				return ErrSourceChanged
			}
			break
		}
		if info.Mode()&os.ModeSymlink == 0 {
			return ErrSourceChanged
		}
		rawTarget, err := executor.fs().Readlink(source)
		if err != nil || rawTarget != step.OriginalTarget {
			return ErrSourceChanged
		}
		destLink := clonePath(group.DestAbs, step.RelativePath)
		mapping, err := NewPathMapper(group.SourceAbs, group.SourceRequestedAbs, group.DestAbs).Map(source, destLink, rawTarget)
		if err != nil || mapping.Kind != step.Mapping || mapping.TargetText != step.TargetText {
			return ErrSourceChanged
		}
	default:
		return ErrSourceChanged
	}
	return nil
}

func (executor Executor) verifyOrdinarySymlinkTarget(group PlanGroup, step PlanStep) error {
	target := step.TargetText
	if !filepath.IsAbs(target) {
		target = filepath.Join(group.DestParentAbs, target)
	}
	target = filepath.Clean(target)
	mapped, err := executor.Planner.Resolver.MapPath(target)
	if err != nil {
		return ErrSourceChanged
	}
	resolved, err := executor.Planner.Resolver.ResolveFollow(mapped.Root.ID, mapped.Rel)
	if err != nil || filepath.Clean(resolved.Actual.Abs) != filepath.Clean(group.SourceAbs) {
		return ErrSourceChanged
	}
	identity, err := executor.Planner.identityReader()(resolved.Actual.Abs, false)
	if err != nil || !identity.SameObject(group.SourceIdentity) {
		return ErrSourceChanged
	}
	return nil
}

func (executor Executor) ensureTargetAbsent(target string) error {
	_, err := executor.fs().Lstat(target)
	switch {
	case err == nil:
		return ErrTargetExists
	case errors.Is(err, os.ErrNotExist):
		return nil
	default:
		return err
	}
}

func (executor Executor) beforeStep(ctx context.Context, hooks ExecutionHooks, step PlanStep) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if hooks.BeforeStep != nil {
		return hooks.BeforeStep(step)
	}
	return nil
}

func (executor Executor) reportFailure(hooks ExecutionHooks, step PlanStep, operationErr error) error {
	if errors.Is(operationErr, context.Canceled) || errors.Is(operationErr, context.DeadlineExceeded) {
		return operationErr
	}
	if reportErr := executor.report(hooks, step, operationErr); reportErr != nil {
		return errors.Join(operationErr, reportErr)
	}
	return operationErr
}

func (executor Executor) report(hooks ExecutionHooks, step PlanStep, operationErr error) error {
	if hooks.Report == nil {
		return nil
	}
	return hooks.Report(step, operationErr)
}

func (executor Executor) fs() executorFileSystem {
	if executor.fileSystem != nil {
		return executor.fileSystem
	}
	return osExecutorFileSystem{}
}

func isDirectoryClone(group PlanGroup) bool {
	return group.Type == LinkHardlink && group.SourceKind == SourceDirectory
}

func orderedCloneSteps(steps []PlanStep) ([]PlanStep, []PlanStep, PlanStep, bool) {
	directories := make([]PlanStep, 0)
	entries := make([]PlanStep, 0)
	var root PlanStep
	hasRoot := false
	for _, step := range steps {
		if step.Action == ActionDirectory {
			directories = append(directories, step)
			if step.RelativePath == "." {
				root = step
				hasRoot = true
			}
		} else {
			entries = append(entries, step)
		}
	}
	sort.SliceStable(directories, func(i, j int) bool {
		firstDepth := pathDepth(directories[i].RelativePath)
		secondDepth := pathDepth(directories[j].RelativePath)
		if firstDepth != secondDepth {
			return firstDepth < secondDepth
		}
		return directories[i].RelativePath < directories[j].RelativePath
	})
	return directories, entries, root, hasRoot
}

func clonePath(root string, relative string) string {
	if relative == "." || relative == "" {
		return root
	}
	return filepath.Join(root, filepath.FromSlash(relative))
}

func pathDepth(relative string) int {
	if relative == "." || relative == "" {
		return 0
	}
	return strings.Count(relative, "/") + 1
}
