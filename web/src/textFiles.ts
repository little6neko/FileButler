const languageDisplayNames = {
  plain: "Plain Text",
  markdown: "Markdown",
  json: "JSON",
  yaml: "YAML",
  toml: "TOML",
  xml: "XML",
  properties: "INI / Properties",
  sql: "SQL",
  diff: "Diff",
  http: "HTTP",
  protobuf: "Protocol Buffers",
  latex: "LaTeX",
  html: "HTML",
  css: "CSS",
  sass: "Sass",
  scss: "SCSS",
  less: "LESS",
  javascript: "JavaScript",
  jsx: "JSX",
  typescript: "TypeScript",
  tsx: "TSX",
  vue: "Vue",
  python: "Python",
  go: "Go",
  rust: "Rust",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  java: "Java",
  kotlin: "Kotlin",
  php: "PHP",
  ruby: "Ruby",
  shell: "Shell",
  powershell: "PowerShell",
  lua: "Lua",
  swift: "Swift",
  dart: "Dart",
  r: "R",
  perl: "Perl",
  groovy: "Groovy",
  scala: "Scala",
  fsharp: "F#",
  objectiveC: "Objective-C",
  visualBasic: "Visual Basic",
  dockerfile: "Dockerfile",
  cmake: "CMake",
  nginx: "Nginx",
} as const;

export type TextLanguage = keyof typeof languageDisplayNames;

export type TextFileDescriptor = {
  language: TextLanguage;
  displayName: string;
  highlight: boolean;
};

const extensionLanguages: Readonly<Record<string, TextLanguage>> = {
  ".ass": "plain",
  ".atom": "xml",
  ".bash": "shell",
  ".bib": "latex",
  ".c": "c",
  ".cc": "cpp",
  ".cfg": "properties",
  ".cjs": "javascript",
  ".cmake": "cmake",
  ".conf": "properties",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".csv": "plain",
  ".cts": "typescript",
  ".cue": "plain",
  ".cxx": "cpp",
  ".dart": "dart",
  ".diff": "diff",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".go": "go",
  ".gradle": "groovy",
  ".groovy": "groovy",
  ".h": "c",
  ".hh": "cpp",
  ".hpp": "cpp",
  ".htm": "html",
  ".html": "html",
  ".http": "http",
  ".hxx": "cpp",
  ".ini": "properties",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".json5": "json",
  ".jsonc": "json",
  ".jsx": "jsx",
  ".ksh": "shell",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".latex": "latex",
  ".less": "less",
  ".log": "plain",
  ".lrc": "plain",
  ".lua": "lua",
  ".m": "objectiveC",
  ".m3u": "plain",
  ".m3u8": "plain",
  ".map": "json",
  ".markdown": "markdown",
  ".md": "markdown",
  ".mdown": "markdown",
  ".mkd": "markdown",
  ".mjs": "javascript",
  ".mm": "objectiveC",
  ".mts": "typescript",
  ".nfo": "plain",
  ".patch": "diff",
  ".php": "php",
  ".phtml": "php",
  ".pl": "perl",
  ".pm": "perl",
  ".properties": "properties",
  ".proto": "protobuf",
  ".ps1": "powershell",
  ".psd1": "powershell",
  ".psm1": "powershell",
  ".py": "python",
  ".pyi": "python",
  ".pyw": "python",
  ".r": "r",
  ".rb": "ruby",
  ".rest": "http",
  ".rs": "rust",
  ".rss": "xml",
  ".sass": "sass",
  ".scala": "scala",
  ".scss": "scss",
  ".sh": "shell",
  ".sql": "sql",
  ".srt": "plain",
  ".ssa": "plain",
  ".swift": "swift",
  ".tex": "latex",
  ".text": "plain",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsv": "plain",
  ".tsx": "tsx",
  ".txt": "plain",
  ".vb": "visualBasic",
  ".vtt": "plain",
  ".vue": "vue",
  ".xhtml": "html",
  ".xml": "xml",
  ".xsd": "xml",
  ".xsl": "xml",
  ".xslt": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "shell",
};

const specialNameLanguages: Readonly<Record<string, TextLanguage>> = {
  ".editorconfig": "properties",
  ".env": "properties",
  ".gitattributes": "plain",
  ".gitignore": "plain",
  ".npmrc": "plain",
  ".yarnrc": "plain",
  "changelog": "plain",
  "cmakelists.txt": "cmake",
  "dockerfile": "dockerfile",
  "gemfile": "ruby",
  "gnumakefile": "plain",
  "go.mod": "plain",
  "go.sum": "plain",
  "go.work": "plain",
  "jenkinsfile": "groovy",
  "license": "plain",
  "makefile": "plain",
  "nginx.conf": "nginx",
  "rakefile": "ruby",
  "readme": "markdown",
};

const descriptorCache = new Map<TextLanguage, TextFileDescriptor>();

export function textFileDescriptor(path: string): TextFileDescriptor | null {
  const name = baseName(path).toLowerCase();
  let language = specialNameLanguages[name];
  if (!language && name.startsWith("dockerfile.")) language = "dockerfile";
  if (!language && name.startsWith(".env.")) language = "properties";
  if (!language) language = extensionLanguages[fileExtension(name)];
  return language ? descriptorForLanguage(language) : null;
}

function descriptorForLanguage(language: TextLanguage): TextFileDescriptor {
  const cached = descriptorCache.get(language);
  if (cached) return cached;
  const descriptor = Object.freeze({
    language,
    displayName: languageDisplayNames[language],
    highlight: language !== "plain",
  });
  descriptorCache.set(language, descriptor);
  return descriptor;
}

function baseName(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
}
