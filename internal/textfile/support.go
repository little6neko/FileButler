package textfile

import (
	"path/filepath"
	"strings"
)

var supportedExtensions = map[string]struct{}{
	".ass": {}, ".atom": {}, ".bash": {}, ".bib": {}, ".c": {}, ".cc": {},
	".cfg": {}, ".cjs": {}, ".cmake": {}, ".conf": {}, ".cpp": {}, ".cs": {}, ".css": {}, ".csv": {},
	".cts": {}, ".cue": {}, ".cxx": {}, ".dart": {}, ".diff": {}, ".fs": {},
	".fsi": {}, ".fsx": {}, ".go": {}, ".gradle": {}, ".groovy": {}, ".h": {},
	".hh": {}, ".hpp": {}, ".htm": {}, ".html": {}, ".http": {}, ".hxx": {},
	".ini": {}, ".java": {}, ".js": {}, ".json": {}, ".json5": {}, ".jsonc": {},
	".jsx": {}, ".ksh": {}, ".kt": {}, ".kts": {}, ".latex": {}, ".less": {},
	".log": {}, ".lrc": {}, ".lua": {}, ".m": {}, ".m3u": {}, ".m3u8": {},
	".map": {}, ".markdown": {}, ".md": {}, ".mdown": {}, ".mkd": {}, ".mjs": {},
	".mm": {}, ".mts": {}, ".nfo": {}, ".patch": {}, ".php": {}, ".phtml": {},
	".pl": {}, ".pm": {}, ".properties": {}, ".proto": {}, ".ps1": {}, ".psd1": {},
	".psm1": {}, ".py": {}, ".pyi": {}, ".pyw": {}, ".r": {}, ".rb": {},
	".rest": {}, ".rs": {}, ".rss": {}, ".sass": {}, ".scala": {}, ".scss": {},
	".sh": {}, ".sql": {}, ".srt": {}, ".ssa": {}, ".swift": {}, ".tex": {},
	".text": {}, ".toml": {}, ".ts": {}, ".tsv": {}, ".tsx": {}, ".txt": {},
	".vb": {}, ".vtt": {}, ".vue": {}, ".xhtml": {}, ".xml": {}, ".xsd": {},
	".xsl": {}, ".xslt": {}, ".yaml": {}, ".yml": {}, ".zsh": {},
}

var supportedSpecialNames = map[string]struct{}{
	".editorconfig": {}, ".env": {}, ".gitattributes": {}, ".gitignore": {},
	".npmrc": {}, ".yarnrc": {}, "changelog": {}, "cmakelists.txt": {},
	"dockerfile": {}, "gemfile": {}, "gnumakefile": {}, "jenkinsfile": {},
	"license": {}, "makefile": {}, "nginx.conf": {}, "rakefile": {},
	"readme": {}, "go.mod": {}, "go.sum": {}, "go.work": {},
}

// IsSupported reports whether path is one of the explicitly supported text files.
func IsSupported(path string) bool {
	name := strings.ToLower(filepath.Base(path))
	if _, ok := supportedSpecialNames[name]; ok {
		return true
	}
	if strings.HasPrefix(name, "dockerfile.") || strings.HasPrefix(name, ".env.") {
		return true
	}
	_, ok := supportedExtensions[strings.ToLower(filepath.Ext(name))]
	return ok
}
