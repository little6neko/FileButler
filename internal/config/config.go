package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Listen         string        `yaml:"listen"`
	DatabasePath   string        `yaml:"database_path"`
	JobConcurrency int           `yaml:"job_concurrency"`
	LogLevel       string        `yaml:"log_level"`
	Session        SessionConfig `yaml:"session"`
	Roots          []RootConfig  `yaml:"roots"`
	StaticDir      string        `yaml:"static_dir"`
}

type SessionConfig struct {
	CookieName    string `yaml:"cookie_name"`
	Secure        bool   `yaml:"secure"`
	MaxAgeSeconds int    `yaml:"max_age_seconds"`
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
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	applyDefaults(&cfg)
	baseDir := filepath.Dir(path)
	if !filepath.IsAbs(cfg.DatabasePath) {
		cfg.DatabasePath = filepath.Join(baseDir, cfg.DatabasePath)
	}
	absDB, err := filepath.Abs(cfg.DatabasePath)
	if err != nil {
		return Config{}, err
	}
	cfg.DatabasePath = absDB
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
	return cfg, nil
}

func applyDefaults(cfg *Config) {
	if cfg.Listen == "" {
		cfg.Listen = "127.0.0.1:8080"
	}
	if cfg.DatabasePath == "" {
		cfg.DatabasePath = "./filebutler.db"
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
	if cfg.Session.MaxAgeSeconds <= 0 {
		cfg.Session.MaxAgeSeconds = int((24 * time.Hour).Seconds())
	}
	if cfg.StaticDir == "" {
		cfg.StaticDir = "web/dist"
	}
}
