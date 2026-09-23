package config

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Cloud115       Cloud115Config `yaml:"cloud115"`
	Listen         string         `yaml:"listen"`
	DatabaseFile   string         `yaml:"database_file"`
	JobConcurrency int            `yaml:"job_concurrency"`
	LogLevel       string         `yaml:"log_level"`
	Session        SessionConfig  `yaml:"session"`
	Roots          []RootConfig   `yaml:"roots"`
	StaticDir      string         `yaml:"static_dir"`
}

type Cloud115Config struct {
	Python string `yaml:"python"`
	Worker string `yaml:"worker"`
}

type SessionConfig struct {
	CookieName string `yaml:"cookie_name"`
	Secure     bool   `yaml:"secure"`
}

type RootConfig struct {
	ID   string `yaml:"id"`
	Name string `yaml:"name"`
	Path string `yaml:"path"`
}

func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	decoder.KnownFields(true)
	if err := decoder.Decode(&cfg); err != nil {
		return Config{}, err
	}
	applyDefaults(&cfg)
	baseDir := filepath.Dir(path)
	if !filepath.IsAbs(cfg.DatabaseFile) {
		cfg.DatabaseFile = filepath.Join(baseDir, cfg.DatabaseFile)
	}
	absDatabaseFile, err := filepath.Abs(cfg.DatabaseFile)
	if err != nil {
		return Config{}, err
	}
	cfg.DatabaseFile = absDatabaseFile
	if cfg.Cloud115.Python == "" {
		cfg.Cloud115.Python = "python3"
	}
	if cfg.Cloud115.Worker == "" {
		cfg.Cloud115.Worker = "cloud115/worker.py"
	}
	if cfg.StaticDir != "" && !filepath.IsAbs(cfg.StaticDir) {
		cfg.StaticDir = filepath.Join(baseDir, cfg.StaticDir)
	}
	seen := map[string]struct{}{}
	for i := range cfg.Roots {
		root := &cfg.Roots[i]
		root.ID = strings.TrimSpace(root.ID)
		root.Name = strings.TrimSpace(root.Name)
		if root.ID == "" {
			return Config{}, fmt.Errorf("root %d has empty id", i)
		}
		if _, ok := seen[root.ID]; ok {
			return Config{}, fmt.Errorf("duplicate root id %q", root.ID)
		}
		seen[root.ID] = struct{}{}
		if root.Name == "" {
			root.Name = root.ID
		}
		if root.Path == "" {
			return Config{}, fmt.Errorf("root %q has empty path", root.ID)
		}
		absRoot, err := filepath.Abs(root.Path)
		if err != nil {
			return Config{}, err
		}
		info, err := os.Stat(absRoot)
		if err != nil {
			return Config{}, fmt.Errorf("root %q path: %w", root.ID, err)
		}
		if !info.IsDir() {
			return Config{}, fmt.Errorf("root %q path is not a directory", root.ID)
		}
		root.Path = absRoot
	}
	if len(cfg.Roots) == 0 {
		return Config{}, errors.New("at least one root is required")
	}
	privateDir, err := canonicalPath(filepath.Dir(cfg.DatabaseFile))
	if err != nil {
		return Config{}, err
	}
	for _, root := range cfg.Roots {
		public, err := canonicalPath(root.Path)
		if err != nil {
			return Config{}, err
		}
		if inside(public, privateDir) {
			return Config{}, errors.New("database directory must be outside browsable roots")
		}
	}
	public, err := canonicalPath(cfg.StaticDir)
	if err != nil {
		return Config{}, err
	}
	if inside(public, privateDir) {
		return Config{}, errors.New("database directory must be outside static assets")
	}
	return cfg, nil
}

func inside(base, path string) bool {
	rel, err := filepath.Rel(base, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
func canonicalPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	tail := []string{}
	current := abs
	for {
		resolved, err := filepath.EvalSymlinks(current)
		if err == nil {
			for i := len(tail) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, tail[i])
			}
			return resolved, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		tail = append(tail, filepath.Base(current))
		current = parent
	}
}

func applyDefaults(cfg *Config) {
	if cfg.Listen == "" {
		cfg.Listen = "127.0.0.1:8080"
	}
	if cfg.DatabaseFile == "" {
		cfg.DatabaseFile = "./data/filebutler.db"
	}
	if cfg.JobConcurrency <= 0 {
		cfg.JobConcurrency = 1
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}
	if cfg.Session.CookieName == "" {
		cfg.Session.CookieName = "filebutler_session"
	}
	if cfg.StaticDir == "" {
		cfg.StaticDir = "web/dist"
	}
}
