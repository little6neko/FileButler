package textfile

import "testing"

func TestIsSupportedRecognizesConfiguredExtensions(t *testing.T) {
	supported := []string{
		"notes.txt", "notes.text", "server.log", "release.nfo",
		"table.csv", "table.tsv", "movie.srt", "movie.vtt", "movie.ass", "movie.ssa", "song.lrc",
		"playlist.m3u", "playlist.m3u8", "album.cue",
		"README.md", "README.markdown", "README.mdown", "README.mkd",
		"data.json", "settings.jsonc", "data.json5", "bundle.map",
		"config.yaml", "config.yml", "config.toml",
		"feed.xml", "schema.xsd", "transform.xsl", "transform.xslt", "feed.rss", "feed.atom",
		"settings.ini", "app.properties", "app.cfg", "app.conf", "query.sql",
		"change.diff", "change.patch", "request.http", "request.rest", "message.proto",
		"paper.tex", "paper.latex", "references.bib",
		"index.html", "index.htm", "index.xhtml", "site.css", "site.sass", "site.scss", "site.less",
		"app.js", "app.mjs", "app.cjs", "app.jsx", "app.ts", "app.mts", "app.cts", "app.tsx", "App.vue",
		"main.py", "window.pyw", "types.pyi", "main.go", "main.rs", "main.c", "main.h",
		"main.cc", "main.cpp", "main.cxx", "main.hpp", "main.hh", "main.hxx", "main.cs", "Main.java",
		"Main.kt", "build.kts", "index.php", "template.phtml", "app.rb",
		"run.sh", "run.bash", "run.zsh", "run.ksh", "run.ps1", "module.psd1", "module.psm1",
		"main.lua", "main.swift", "main.dart", "analysis.r", "script.pl", "Module.pm",
		"build.groovy", "build.gradle", "Main.scala", "Main.fs", "Main.fsx", "Main.fsi",
		"main.m", "main.mm", "Module.vb",
	}

	for _, path := range supported {
		t.Run(path, func(t *testing.T) {
			if !IsSupported(path) {
				t.Fatalf("IsSupported(%q)=false", path)
			}
		})
	}
}

func TestIsSupportedRecognizesSpecialFileNames(t *testing.T) {
	supported := []string{
		"Dockerfile", "Dockerfile.dev", "CMakeLists.txt", "toolchain.cmake", "Jenkinsfile",
		"Gemfile", "Rakefile", "nginx.conf", ".env", ".env.local", ".editorconfig",
		".gitignore", ".gitattributes", ".npmrc", ".yarnrc", "Makefile", "GNUmakefile",
		"README", "LICENSE", "CHANGELOG", "go.mod", "go.sum", "go.work",
	}

	for _, path := range supported {
		t.Run(path, func(t *testing.T) {
			if !IsSupported("nested/" + path) {
				t.Fatalf("IsSupported(%q)=false", path)
			}
		})
	}
}

func TestIsSupportedIsCaseInsensitiveAndRejectsOtherFiles(t *testing.T) {
	for _, path := range []string{"MAIN.PY", "DOCKERFILE.DEV", ".ENV.LOCAL", "README.MD"} {
		if !IsSupported(path) {
			t.Fatalf("IsSupported(%q)=false", path)
		}
	}
	for _, path := range []string{"image.svg", "photo.jpg", "movie.mp4", "archive.zip", "program.exe", "unknown", ".unknown"} {
		if IsSupported(path) {
			t.Fatalf("IsSupported(%q)=true", path)
		}
	}
}
