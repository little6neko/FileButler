import { describe, expect, it } from "vitest";
import { textFileDescriptor, type TextLanguage } from "./textFiles";

describe("text file descriptors", () => {
  it.each([
    ["plain", ["txt", "text", "log", "nfo", "csv", "tsv", "srt", "vtt", "ass", "ssa", "lrc", "m3u", "m3u8", "cue"]],
    ["markdown", ["md", "markdown", "mdown", "mkd"]],
    ["json", ["json", "jsonc", "json5", "map"]],
    ["yaml", ["yaml", "yml"]],
    ["toml", ["toml"]],
    ["xml", ["xml", "xsd", "xsl", "xslt", "rss", "atom"]],
    ["properties", ["ini", "properties", "cfg", "conf"]],
    ["sql", ["sql"]],
    ["diff", ["diff", "patch"]],
    ["http", ["http", "rest"]],
    ["protobuf", ["proto"]],
    ["latex", ["tex", "latex", "bib"]],
    ["html", ["html", "htm", "xhtml"]],
    ["css", ["css"]],
    ["sass", ["sass"]],
    ["scss", ["scss"]],
    ["less", ["less"]],
    ["javascript", ["js", "mjs", "cjs"]],
    ["jsx", ["jsx"]],
    ["typescript", ["ts", "mts", "cts"]],
    ["tsx", ["tsx"]],
    ["vue", ["vue"]],
    ["python", ["py", "pyw", "pyi"]],
    ["go", ["go"]],
    ["rust", ["rs"]],
    ["c", ["c", "h"]],
    ["cpp", ["cc", "cpp", "cxx", "hpp", "hh", "hxx"]],
    ["csharp", ["cs"]],
    ["java", ["java"]],
    ["kotlin", ["kt", "kts"]],
    ["php", ["php", "phtml"]],
    ["ruby", ["rb"]],
    ["shell", ["sh", "bash", "zsh", "ksh"]],
    ["powershell", ["ps1", "psd1", "psm1"]],
    ["lua", ["lua"]],
    ["swift", ["swift"]],
    ["dart", ["dart"]],
    ["r", ["r"]],
    ["perl", ["pl", "pm"]],
    ["groovy", ["groovy", "gradle"]],
    ["scala", ["scala"]],
    ["fsharp", ["fs", "fsx", "fsi"]],
    ["objectiveC", ["m", "mm"]],
    ["visualBasic", ["vb"]],
  ] satisfies [TextLanguage, string[]][])("maps %s extensions", (language, extensions) => {
    for (const extension of extensions) {
      expect(textFileDescriptor(`nested/example.${extension}`), extension).toMatchObject({ language });
    }
  });

  it.each([
    ["Dockerfile", "dockerfile"],
    ["Dockerfile.dev", "dockerfile"],
    ["CMakeLists.txt", "cmake"],
    ["toolchain.cmake", "cmake"],
    ["Jenkinsfile", "groovy"],
    ["Gemfile", "ruby"],
    ["Rakefile", "ruby"],
    ["nginx.conf", "nginx"],
    [".env", "properties"],
    [".env.local", "properties"],
    [".editorconfig", "properties"],
    [".gitignore", "plain"],
    [".gitattributes", "plain"],
    [".npmrc", "plain"],
    [".yarnrc", "plain"],
    ["Makefile", "plain"],
    ["GNUmakefile", "plain"],
    ["README", "markdown"],
    ["LICENSE", "plain"],
    ["CHANGELOG", "plain"],
    ["go.mod", "plain"],
    ["go.sum", "plain"],
    ["go.work", "plain"],
  ] satisfies [string, TextLanguage][])("maps special file %s", (name, language) => {
    expect(textFileDescriptor(`nested/${name}`)).toMatchObject({ language });
  });

  it("matches names and extensions without regard to case", () => {
    expect(textFileDescriptor("MAIN.PY")?.language).toBe("python");
    expect(textFileDescriptor("DOCKERFILE.DEV")?.language).toBe("dockerfile");
    expect(textFileDescriptor(".ENV.LOCAL")?.language).toBe("properties");
  });

  it("returns stable display metadata for highlighted and plain files", () => {
    expect(textFileDescriptor("main.go")).toEqual({ language: "go", displayName: "Go", highlight: true });
    expect(textFileDescriptor("notes.txt")).toEqual({ language: "plain", displayName: "Plain Text", highlight: false });
  });

  it.each(["image.svg", "photo.jpg", "movie.mp4", "archive.zip", "program.exe", "unknown", ".unknown"])(
    "rejects unsupported path %s",
    (path) => expect(textFileDescriptor(path)).toBeNull(),
  );
});
