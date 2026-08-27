package superrename

type MediaKind string

const (
	MediaKindImage MediaKind = "image"
	MediaKindVideo MediaKind = "video"
)

type EntryKind string

const (
	EntryKindFile      EntryKind = "file"
	EntryKindDirectory EntryKind = "directory"
	EntryKindSymlink   EntryKind = "symlink"
	EntryKindOther     EntryKind = "other"
)

type UnmatchedReason string

const (
	UnmatchedUnsupportedExtension UnmatchedReason = "unsupported-extension"
	UnmatchedNestedDirectory      UnmatchedReason = "nested-directory"
	UnmatchedSymlink              UnmatchedReason = "symlink"
	UnmatchedSpecial              UnmatchedReason = "special"
)

type VideoDirectoryStatus string

const (
	VideoDirectoryMissing       VideoDirectoryStatus = "missing"
	VideoDirectoryPresent       VideoDirectoryStatus = "directory"
	VideoDirectoryBlockingEntry VideoDirectoryStatus = "blocking-entry"
)

type Candidate struct {
	SourcePath string    `json:"sourcePath"`
	Name       string    `json:"name"`
	Extension  string    `json:"extension"`
	MediaKind  MediaKind `json:"mediaKind"`
}

type Unmatched struct {
	Path   string          `json:"path"`
	Name   string          `json:"name"`
	Kind   EntryKind       `json:"kind"`
	Reason UnmatchedReason `json:"reason"`
}

type VideoDirectory struct {
	Status        VideoDirectoryStatus `json:"status"`
	Path          string               `json:"path"`
	OccupiedPaths []string             `json:"occupiedPaths"`
}

type InventoryGroup struct {
	Path                string         `json:"path"`
	Name                string         `json:"name"`
	Images              []Candidate    `json:"images"`
	Videos              []Candidate    `json:"videos"`
	Unmatched           []Unmatched    `json:"unmatched"`
	DirectOccupiedPaths []string       `json:"directOccupiedPaths"`
	VideoDirectory      VideoDirectory `json:"videoDirectory"`
	RecoveryResidues    []string       `json:"recoveryResidues"`
}

type Inventory struct {
	RootID          string           `json:"rootId"`
	DirectoryPath   string           `json:"directoryPath"`
	GeneratedAtUnix int64            `json:"generatedAtUnix"`
	Groups          []InventoryGroup `json:"groups"`
}

type ProjectedCandidate struct {
	Candidate
	Selected   bool   `json:"selected"`
	TargetPath string `json:"targetPath"`
	TargetName string `json:"targetName"`
	Changed    bool   `json:"changed"`
}

type ConflictCode string

const (
	ConflictTargetOccupied        ConflictCode = "target_occupied"
	ConflictDuplicateTarget       ConflictCode = "duplicate_target"
	ConflictVideoDirectoryBlocked ConflictCode = "video_directory_blocked"
	ConflictRecoveryRequired      ConflictCode = "recovery_required"
)

type PlanItem struct {
	SourcePath string       `json:"sourcePath"`
	SourceName string       `json:"sourceName"`
	TargetPath string       `json:"targetPath"`
	TargetName string       `json:"targetName"`
	Extension  string       `json:"extension"`
	MediaKind  MediaKind    `json:"mediaKind"`
	Changed    bool         `json:"changed"`
	Conflict   bool         `json:"conflict"`
	ErrorCode  ConflictCode `json:"errorCode,omitempty"`
	ErrorText  string       `json:"errorText,omitempty"`
}

type PlanGroup struct {
	Path                 string     `json:"path"`
	Name                 string     `json:"name"`
	Items                []PlanItem `json:"items"`
	CreateVideoDirectory bool       `json:"createVideoDirectory"`
	HasConflict          bool       `json:"hasConflict"`
}

type PlanSummary struct {
	GroupCount                int `json:"groupCount"`
	MatchedGroupCount         int `json:"matchedGroupCount"`
	SelectedCount             int `json:"selectedCount"`
	UnmatchedCount            int `json:"unmatchedCount"`
	ConflictCount             int `json:"conflictCount"`
	CreateVideoDirectoryCount int `json:"createVideoDirectoryCount"`
}

type Plan struct {
	RootID        string      `json:"rootId"`
	DirectoryPath string      `json:"directoryPath"`
	Groups        []PlanGroup `json:"groups"`
	Summary       PlanSummary `json:"summary"`
	HasConflict   bool        `json:"hasConflict"`
}
