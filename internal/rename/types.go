package rename

type TargetPart string

const (
	TargetName      TargetPart = "name"
	TargetExtension TargetPart = "extension"
	TargetBoth      TargetPart = "both"
)

type Options struct {
	Search            string     `json:"search"`
	Replace           string     `json:"replace"`
	UseRegex          bool       `json:"useRegex"`
	CaseSensitive     bool       `json:"caseSensitive"`
	MatchAll          bool       `json:"matchAll"`
	Target            TargetPart `json:"target"`
	IncludeFiles      bool       `json:"includeFiles"`
	IncludeDirs       bool       `json:"includeDirs"`
	IncludeSubfolders bool       `json:"includeSubfolders"`
	Enumerate         bool       `json:"enumerate"`
}

type PowerRenameOptions struct {
	Search            string `json:"search"`
	Replace           string `json:"replace"`
	UseRegex          bool   `json:"useRegex"`
	CaseSensitive     bool   `json:"caseSensitive"`
	MatchAll          bool   `json:"matchAll"`
	NameOnly          bool   `json:"nameOnly"`
	ExtensionOnly     bool   `json:"extensionOnly"`
	FullName          bool   `json:"fullName"`
	ExcludeFiles      bool   `json:"excludeFiles"`
	ExcludeFolders    bool   `json:"excludeFolders"`
	ExcludeSubfolders bool   `json:"excludeSubfolders"`
	Uppercase         bool   `json:"uppercase"`
	Lowercase         bool   `json:"lowercase"`
	Titlecase         bool   `json:"titlecase"`
	Capitalized       bool   `json:"capitalized"`
	EnumerateItems    bool   `json:"enumerateItems"`
	RandomizeItems    bool   `json:"randomizeItems"`

	LegacyAppendEnumeration bool `json:"-"`
	TemplateContext         PowerRenameTemplateContext `json:"-"`
}

type InputItem struct {
	RelativePath string
	IsDir        bool
}

type PlanItem struct {
	SourcePath string `json:"sourcePath"`
	TargetPath string `json:"targetPath"`
	OldName    string `json:"oldName"`
	NewName    string `json:"newName"`
	Changed    bool   `json:"changed"`
	Conflict   bool   `json:"conflict"`
	ErrorCode  string `json:"errorCode,omitempty"`
	ErrorText  string `json:"errorText,omitempty"`
}

type PlanResult struct {
	Items       []PlanItem `json:"items"`
	HasConflict bool       `json:"hasConflict"`
}
