type LanguageCatalogEntry = Readonly<{
  id: string;
  displayName: string;
  codeMirrorName: string | null;
  extensions: readonly string[];
  fileNames: readonly string[];
  fileNamePrefixes: readonly string[];
  automaticCodeMirrorNames?: Readonly<Record<string, string>>;
}>;

const rawTextLanguageCatalog = [
  {
    id: "plain",
    displayName: "Plain Text",
    codeMirrorName: null,
    extensions: [".ass", ".csv", ".cue", ".log", ".lrc", ".m3u", ".m3u8", ".nfo", ".srt", ".ssa", ".text", ".tsv", ".txt", ".vtt"],
    fileNames: [".gitattributes", ".gitignore", ".npmrc", ".yarnrc", "changelog", "gnumakefile", "go.mod", "go.sum", "go.work", "license", "makefile"],
    fileNamePrefixes: [],
  },
  {
    id: "markdown",
    displayName: "Markdown",
    codeMirrorName: "Markdown",
    extensions: [".markdown", ".md", ".mdown", ".mkd"],
    fileNames: ["readme"],
    fileNamePrefixes: [],
  },
  { id: "json", displayName: "JSON", codeMirrorName: "JSON", extensions: [".json", ".json5", ".jsonc", ".map"], fileNames: [], fileNamePrefixes: [] },
  { id: "yaml", displayName: "YAML", codeMirrorName: "YAML", extensions: [".yaml", ".yml"], fileNames: [], fileNamePrefixes: [] },
  { id: "toml", displayName: "TOML", codeMirrorName: "TOML", extensions: [".toml"], fileNames: [], fileNamePrefixes: [] },
  { id: "xml", displayName: "XML", codeMirrorName: "XML", extensions: [".atom", ".rss", ".xml", ".xsd", ".xsl", ".xslt"], fileNames: [], fileNamePrefixes: [] },
  {
    id: "properties",
    displayName: "INI / Properties",
    codeMirrorName: "Properties files",
    extensions: [".cfg", ".conf", ".ini", ".properties"],
    fileNames: [".editorconfig", ".env"],
    fileNamePrefixes: [".env."],
  },
  { id: "sql", displayName: "SQL", codeMirrorName: "SQL", extensions: [".sql"], fileNames: [], fileNamePrefixes: [] },
  { id: "diff", displayName: "Diff", codeMirrorName: "diff", extensions: [".diff", ".patch"], fileNames: [], fileNamePrefixes: [] },
  { id: "http", displayName: "HTTP", codeMirrorName: "HTTP", extensions: [".http", ".rest"], fileNames: [], fileNamePrefixes: [] },
  { id: "protobuf", displayName: "Protocol Buffers", codeMirrorName: "ProtoBuf", extensions: [".proto"], fileNames: [], fileNamePrefixes: [] },
  { id: "latex", displayName: "LaTeX", codeMirrorName: "LaTeX", extensions: [".bib", ".latex", ".tex"], fileNames: [], fileNamePrefixes: [] },
  { id: "html", displayName: "HTML", codeMirrorName: "HTML", extensions: [".htm", ".html", ".xhtml"], fileNames: [], fileNamePrefixes: [] },
  { id: "css", displayName: "CSS", codeMirrorName: "CSS", extensions: [".css"], fileNames: [], fileNamePrefixes: [] },
  { id: "sass", displayName: "Sass", codeMirrorName: "Sass", extensions: [".sass"], fileNames: [], fileNamePrefixes: [] },
  { id: "scss", displayName: "SCSS", codeMirrorName: "SCSS", extensions: [".scss"], fileNames: [], fileNamePrefixes: [] },
  { id: "less", displayName: "LESS", codeMirrorName: "LESS", extensions: [".less"], fileNames: [], fileNamePrefixes: [] },
  { id: "javascript", displayName: "JavaScript", codeMirrorName: "JavaScript", extensions: [".cjs", ".js", ".mjs"], fileNames: [], fileNamePrefixes: [] },
  { id: "jsx", displayName: "JSX", codeMirrorName: "JSX", extensions: [".jsx"], fileNames: [], fileNamePrefixes: [] },
  { id: "typescript", displayName: "TypeScript", codeMirrorName: "TypeScript", extensions: [".cts", ".mts", ".ts"], fileNames: [], fileNamePrefixes: [] },
  { id: "tsx", displayName: "TSX", codeMirrorName: "TSX", extensions: [".tsx"], fileNames: [], fileNamePrefixes: [] },
  { id: "vue", displayName: "Vue", codeMirrorName: "Vue", extensions: [".vue"], fileNames: [], fileNamePrefixes: [] },
  { id: "python", displayName: "Python", codeMirrorName: "Python", extensions: [".py", ".pyi", ".pyw"], fileNames: [], fileNamePrefixes: [] },
  { id: "go", displayName: "Go", codeMirrorName: "Go", extensions: [".go"], fileNames: [], fileNamePrefixes: [] },
  { id: "rust", displayName: "Rust", codeMirrorName: "Rust", extensions: [".rs"], fileNames: [], fileNamePrefixes: [] },
  { id: "c", displayName: "C", codeMirrorName: "C", extensions: [".c", ".h"], fileNames: [], fileNamePrefixes: [] },
  { id: "cpp", displayName: "C++", codeMirrorName: "C++", extensions: [".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"], fileNames: [], fileNamePrefixes: [] },
  { id: "csharp", displayName: "C#", codeMirrorName: "C#", extensions: [".cs"], fileNames: [], fileNamePrefixes: [] },
  { id: "java", displayName: "Java", codeMirrorName: "Java", extensions: [".java"], fileNames: [], fileNamePrefixes: [] },
  { id: "kotlin", displayName: "Kotlin", codeMirrorName: "Kotlin", extensions: [".kt", ".kts"], fileNames: [], fileNamePrefixes: [] },
  { id: "php", displayName: "PHP", codeMirrorName: "PHP", extensions: [".php", ".phtml"], fileNames: [], fileNamePrefixes: [] },
  { id: "ruby", displayName: "Ruby", codeMirrorName: "Ruby", extensions: [".rb"], fileNames: ["gemfile", "rakefile"], fileNamePrefixes: [] },
  { id: "shell", displayName: "Shell", codeMirrorName: "Shell", extensions: [".bash", ".ksh", ".sh", ".zsh"], fileNames: [], fileNamePrefixes: [] },
  { id: "powershell", displayName: "PowerShell", codeMirrorName: "PowerShell", extensions: [".ps1", ".psd1", ".psm1"], fileNames: [], fileNamePrefixes: [] },
  { id: "lua", displayName: "Lua", codeMirrorName: "Lua", extensions: [".lua"], fileNames: [], fileNamePrefixes: [] },
  { id: "swift", displayName: "Swift", codeMirrorName: "Swift", extensions: [".swift"], fileNames: [], fileNamePrefixes: [] },
  { id: "dart", displayName: "Dart", codeMirrorName: "Dart", extensions: [".dart"], fileNames: [], fileNamePrefixes: [] },
  { id: "r", displayName: "R", codeMirrorName: "R", extensions: [".r"], fileNames: [], fileNamePrefixes: [] },
  { id: "perl", displayName: "Perl", codeMirrorName: "Perl", extensions: [".pl", ".pm"], fileNames: [], fileNamePrefixes: [] },
  { id: "groovy", displayName: "Groovy", codeMirrorName: "Groovy", extensions: [".gradle", ".groovy"], fileNames: ["jenkinsfile"], fileNamePrefixes: [] },
  { id: "scala", displayName: "Scala", codeMirrorName: "Scala", extensions: [".scala"], fileNames: [], fileNamePrefixes: [] },
  { id: "fsharp", displayName: "F#", codeMirrorName: "F#", extensions: [".fs", ".fsi", ".fsx"], fileNames: [], fileNamePrefixes: [] },
  {
    id: "objectiveC",
    displayName: "Objective-C",
    codeMirrorName: "Objective-C",
    extensions: [".m", ".mm"],
    fileNames: [],
    fileNamePrefixes: [],
    automaticCodeMirrorNames: { ".mm": "Objective-C++" },
  },
  { id: "visualBasic", displayName: "Visual Basic", codeMirrorName: "VB.NET", extensions: [".vb"], fileNames: [], fileNamePrefixes: [] },
  { id: "dockerfile", displayName: "Dockerfile", codeMirrorName: "Dockerfile", extensions: [], fileNames: ["dockerfile"], fileNamePrefixes: ["dockerfile."] },
  { id: "cmake", displayName: "CMake", codeMirrorName: "CMake", extensions: [".cmake"], fileNames: ["cmakelists.txt"], fileNamePrefixes: [] },
  { id: "nginx", displayName: "Nginx", codeMirrorName: "Nginx", extensions: [], fileNames: ["nginx.conf"], fileNamePrefixes: [] },
] as const satisfies readonly LanguageCatalogEntry[];

export type TextLanguage = (typeof rawTextLanguageCatalog)[number]["id"];

export type TextLanguageDefinition = Readonly<{
  id: TextLanguage;
  displayName: string;
  codeMirrorName: string | null;
  extensions: readonly string[];
  fileNames: readonly string[];
  fileNamePrefixes: readonly string[];
  automaticCodeMirrorNames?: Readonly<Record<string, string>>;
}>;

export const textLanguageCatalog: readonly TextLanguageDefinition[] = rawTextLanguageCatalog;

export type TextFileDescriptor = {
  language: TextLanguage;
  displayName: string;
  highlight: boolean;
};

const definitionsByLanguage = new Map<TextLanguage, TextLanguageDefinition>(
  textLanguageCatalog.map((definition) => [definition.id, definition]),
);
const extensionLanguages = new Map<string, TextLanguage>();
const specialNameLanguages = new Map<string, TextLanguage>();
const prefixLanguages: { prefix: string; language: TextLanguage }[] = [];

for (const definition of textLanguageCatalog) {
  for (const extension of definition.extensions) extensionLanguages.set(extension, definition.id);
  for (const fileName of definition.fileNames) specialNameLanguages.set(fileName, definition.id);
  for (const prefix of definition.fileNamePrefixes) prefixLanguages.push({ prefix, language: definition.id });
}

const selectableLanguages = Object.freeze([
  textLanguageDefinition("plain"),
  ...textLanguageCatalog
    .filter(({ id }) => id !== "plain")
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName)),
]);
const descriptorCache = new Map<TextLanguage, TextFileDescriptor>();

export function textLanguageDefinition(language: TextLanguage): TextLanguageDefinition {
  const definition = definitionsByLanguage.get(language);
  if (!definition) throw new Error(`Unknown text language: ${language}`);
  return definition;
}

export function textLanguageOptions(): readonly TextLanguageDefinition[] {
  return selectableLanguages;
}

export function codeMirrorLanguageDescriptionName(
  language: TextLanguage,
  automaticFileName?: string,
): string | null {
  const definition = textLanguageDefinition(language);
  if (!automaticFileName || !definition.automaticCodeMirrorNames) return definition.codeMirrorName;
  const name = baseName(automaticFileName).toLowerCase();
  return definition.automaticCodeMirrorNames[fileExtension(name)] ?? definition.codeMirrorName;
}

export function textFileDescriptor(path: string): TextFileDescriptor | null {
  const name = baseName(path).toLowerCase();
  let language = specialNameLanguages.get(name);
  if (!language) language = prefixLanguages.find(({ prefix }) => name.startsWith(prefix))?.language;
  if (!language) language = extensionLanguages.get(fileExtension(name));
  return language ? descriptorForLanguage(language) : null;
}

function descriptorForLanguage(language: TextLanguage): TextFileDescriptor {
  const cached = descriptorCache.get(language);
  if (cached) return cached;
  const definition = textLanguageDefinition(language);
  const descriptor = Object.freeze({
    language,
    displayName: definition.displayName,
    highlight: definition.codeMirrorName !== null,
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
