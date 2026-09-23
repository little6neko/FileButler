package config

import (
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
	AuthFile       string         `yaml:"auth_file"`
	JobConcurrency int            `yaml:"job_concurrency"`
	LogLevel       string         `yaml:"log_level"`
	Session        SessionConfig  `yaml:"session"`
	Roots          []RootConfig   `yaml:"roots"`
	StaticDir      string         `yaml:"static_dir"`
}

type Cloud115Config struct {
	Python      string `yaml:"python"`
	Worker      string `yaml:"worker"`
	Credentials string `yaml:"credentials"`
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
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	applyDefaults(&cfg)
	baseDir := filepath.Dir(path)
	if !filepath.IsAbs(cfg.AuthFile) {
		cfg.AuthFile = filepath.Join(baseDir, cfg.AuthFile)
	}
	absAuthFile, err := filepath.Abs(cfg.AuthFile)
	if err != nil {
		return Config{}, err
	}
	cfg.AuthFile = absAuthFile
	if cfg.Cloud115.Python == "" {
		cfg.Cloud115.Python = "python3"
	}
	if cfg.Cloud115.Worker == "" {
		cfg.Cloud115.Worker = "cloud115/worker.py"
	}
	if cfg.Cloud115.Credentials == "" {
		cfg.Cloud115.Credentials = filepath.Join(filepath.Dir(cfg.AuthFile), "115-cookies.txt")
	} else if !filepath.IsAbs(cfg.Cloud115.Credentials) {
		cfg.Cloud115.Credentials = filepath.Join(baseDir, cfg.Cloud115.Credentials)
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
	return cfg, nil
}

func applyDefaults(cfg *Config) {
	if cfg.Listen == "" {
		cfg.Listen = "127.0.0.1:8080"
	}
	if cfg.AuthFile == "" {
		cfg.AuthFile = "./data/auth.json"
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
