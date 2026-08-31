package links

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type DirectoryMaintainer interface {
	Maintain(context.Context, string) (map[string]struct{}, error)
}

type ActiveJobLookup interface {
	RuntimeID() string
	IsActive(context.Context, string) (bool, error)
}

type StagingMaintainer struct {
	Manager StagingManager
	Jobs    ActiveJobLookup
}

type StagingMaintenanceError struct {
	Identifier string
	Cause      error
}

func (err *StagingMaintenanceError) Error() string {
	return fmt.Sprintf("unable to maintain link staging container %s", err.Identifier)
}

func (err *StagingMaintenanceError) Unwrap() error {
	return err.Cause
}

func (maintainer StagingMaintainer) Maintain(ctx context.Context, directory string) (map[string]struct{}, error) {
	hidden := make(map[string]struct{})
	entries, err := os.ReadDir(directory)
	if err != nil {
		return hidden, &StagingMaintenanceError{Identifier: "directory", Cause: err}
	}
	currentRuntime := ""
	if maintainer.Jobs != nil {
		currentRuntime = maintainer.Jobs.RuntimeID()
	}
	var maintenanceErr error
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return hidden, errors.Join(maintenanceErr, err)
		}
		if !strings.HasPrefix(entry.Name(), stagingPrefix) {
			continue
		}
		container := filepath.Join(directory, entry.Name())
		marker, valid, err := maintainer.Manager.Validate(container)
		if err != nil {
			hidden[entry.Name()] = struct{}{}
			maintenanceErr = errors.Join(maintenanceErr, &StagingMaintenanceError{Identifier: entry.Name(), Cause: err})
			continue
		}
		if !valid {
			continue
		}
		hidden[entry.Name()] = struct{}{}
		if currentRuntime == "" {
			maintenanceErr = errors.Join(maintenanceErr, &StagingMaintenanceError{
				Identifier: entry.Name(), Cause: errors.New("job state is unavailable"),
			})
			continue
		}
		if marker.RuntimeID == currentRuntime {
			active, err := maintainer.Jobs.IsActive(ctx, marker.JobID)
			if err != nil {
				maintenanceErr = errors.Join(maintenanceErr, &StagingMaintenanceError{Identifier: entry.Name(), Cause: err})
				continue
			}
			if active {
				continue
			}
		}
		area := StagingArea{
			Container:  container,
			Payload:    filepath.Join(container, payloadName),
			MarkerPath: filepath.Join(container, markerName),
			Marker:     marker,
		}
		if err := maintainer.Manager.Cleanup(area); err != nil {
			maintenanceErr = errors.Join(maintenanceErr, &StagingMaintenanceError{Identifier: entry.Name(), Cause: err})
			continue
		}
		delete(hidden, entry.Name())
	}
	return hidden, maintenanceErr
}
