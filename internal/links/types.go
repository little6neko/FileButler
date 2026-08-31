package links

import (
	"errors"
	"os"
)

type LinkType string

const (
	LinkHardlink LinkType = "hardlink"
	LinkSymlink  LinkType = "symlink"
)

type SourceKind string

const (
	SourceFile      SourceKind = "file"
	SourceDirectory SourceKind = "directory"
	SourceSymlink   SourceKind = "symlink"
	SourceOther     SourceKind = "other"
)

type ErrorCode string

const (
	ErrorTargetExists            ErrorCode = "target_exists"
	ErrorMissingSource           ErrorCode = "missing_source"
	ErrorSourceChanged           ErrorCode = "source_changed"
	ErrorUnsupportedSource       ErrorCode = "unsupported_source"
	ErrorSpecialEntry            ErrorCode = "special_entry"
	ErrorCrossFilesystem         ErrorCode = "cross_filesystem"
	ErrorDestinationInsideSource ErrorCode = "destination_inside_source"
	ErrorOutsideRoot             ErrorCode = "outside_root"
	ErrorInvalidPath             ErrorCode = "invalid_path"
	ErrorOperationFailed         ErrorCode = "operation_failed"
)

var (
	ErrInvalidRequest      = errors.New("invalid_link_request")
	ErrIdentityUnsupported = errors.New("file_identity_unsupported")
	ErrNotDirectory        = errors.New("link_destination_not_directory")
)

type Request struct {
	Type       LinkType `json:"type"`
	SourceRoot string   `json:"sourceRoot"`
	Sources    []string `json:"sources"`
	DestRoot   string   `json:"destRoot"`
	DestPath   string   `json:"destPath"`
}

type JobRequest struct {
	Type            LinkType `json:"type"`
	SourceRoot      string   `json:"sourceRoot"`
	Sources         []string `json:"sources"`
	DestRoot        string   `json:"destRoot"`
	DestPath        string   `json:"destPath"`
	PreviewRevision string   `json:"previewRevision"`
}

func (request JobRequest) PreviewRequest() Request {
	return Request{
		Type:       request.Type,
		SourceRoot: request.SourceRoot,
		Sources:    request.Sources,
		DestRoot:   request.DestRoot,
		DestPath:   request.DestPath,
	}
}

type Counts struct {
	Directories int `json:"directories"`
	Files       int `json:"files"`
	Symlinks    int `json:"symlinks"`
}

func (counts Counts) Total() int {
	return counts.Directories + counts.Files + counts.Symlinks
}

type PreviewItem struct {
	SourcePath string     `json:"sourcePath"`
	DestPath   string     `json:"destPath"`
	SourceKind SourceKind `json:"sourceKind"`
	Counts     Counts     `json:"counts"`
	Conflict   bool       `json:"conflict"`
	ErrorCode  ErrorCode  `json:"errorCode,omitempty"`
	ErrorText  string     `json:"errorText,omitempty"`
}

type Preview struct {
	Type            LinkType      `json:"type"`
	SourceRoot      string        `json:"sourceRoot"`
	DestRoot        string        `json:"destRoot"`
	DestPath        string        `json:"destPath"`
	PreviewRevision string        `json:"previewRevision"`
	ProgressTotal   int           `json:"progressTotal"`
	HasConflict     bool          `json:"hasConflict"`
	Items           []PreviewItem `json:"items"`
}

type ActionKind string

const (
	ActionDirectory ActionKind = "directory"
	ActionHardlink  ActionKind = "hardlink"
	ActionSymlink   ActionKind = "symlink"
)

type LinkMappingKind string

const (
	MappingInternal LinkMappingKind = "internal"
	MappingExternal LinkMappingKind = "external"
)

type PlanStep struct {
	Action           ActionKind
	RelativePath     string
	SourceIdentity   FileIdentity
	Mode             os.FileMode
	ModifiedUnixNano int64
	OriginalTarget   string
	TargetText       string
	Mapping          LinkMappingKind
}

type PlanGroup struct {
	Type                LinkType
	PreviewRevision     string
	SourceRoot          string
	SourcePath          string
	SourceKind          SourceKind
	SourceAbs           string
	SourceRequestedAbs  string
	SourceIdentity      FileIdentity
	DestRoot            string
	DestPath            string
	DestName            string
	DestParentAbs       string
	DestAbs             string
	DestinationIdentity FileIdentity
	Steps               []PlanStep
	Conflict            bool
	ErrorCode           ErrorCode
	target              targetSnapshot
}

type targetSnapshot struct {
	Occupied bool
	Kind     SourceKind
	Identity FileIdentity
}

type Plan struct {
	Preview Preview     `json:"-"`
	Groups  []PlanGroup `json:"-"`
}

func (plan Plan) Public() Preview {
	return plan.Preview
}

func (group PlanGroup) Counts() Counts {
	return countSteps(group.Steps)
}
