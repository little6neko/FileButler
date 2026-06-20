package ops

type OperationType string

const (
	OpMove     OperationType = "move"
	OpCopy     OperationType = "copy"
	OpSymlink  OperationType = "symlink"
	OpHardlink OperationType = "hardlink"
	OpDelete   OperationType = "delete"
	OpMkdir    OperationType = "mkdir"
)

type Request struct {
	Type       OperationType `json:"type"`
	SourceRoot string        `json:"sourceRoot"`
	Sources    []string      `json:"sources"`
	DestRoot   string        `json:"destRoot,omitempty"`
	DestPath   string        `json:"destPath,omitempty"`
	NewName    string        `json:"newName,omitempty"`
}

type PlanItem struct {
	Operation  OperationType `json:"operation"`
	SourceRoot string        `json:"sourceRoot,omitempty"`
	SourcePath string        `json:"sourcePath"`
	DestRoot   string        `json:"destRoot,omitempty"`
	DestPath   string        `json:"destPath,omitempty"`
	Conflict   bool          `json:"conflict"`
	ErrorCode  string        `json:"errorCode,omitempty"`
	ErrorText  string        `json:"errorText,omitempty"`
}

type Plan struct {
	Items       []PlanItem `json:"items"`
	HasConflict bool       `json:"hasConflict"`
}
