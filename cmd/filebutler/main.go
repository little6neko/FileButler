package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/browser"
	"github.com/little6neko/filebutler/internal/config"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/ops"
	"github.com/little6neko/filebutler/internal/rename"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/superrename"
	"github.com/little6neko/filebutler/internal/web"
)

func main() {
	configPath := flag.String("config", "configs/filebutler.example.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	authService, err := auth.Open(cfg.AuthFile)
	if err != nil {
		log.Fatalf("load authentication: %v", err)
	}

	rootItems := make([]roots.Root, len(cfg.Roots))
	for i, root := range cfg.Roots {
		rootItems[i] = roots.Root{ID: root.ID, Name: root.Name, Path: root.Path}
	}
	resolver := roots.NewResolver(rootItems)
	jobStore := jobs.NewStore()
	opsExecutor := ops.Executor{Resolver: resolver}
	router := web.NewRouter(web.Deps{
		Config:       cfg,
		Auth:         authService,
		Roots:        resolver,
		Browser:      browser.Service{Resolver: resolver},
		OpsPlanner:   ops.Planner{Resolver: resolver},
		JobStore:     jobStore,
		OpsRunner:    jobs.Runner{Store: jobStore, Executor: ops.JobExecutor{Executor: opsExecutor}},
		RenameRunner: jobs.Runner{Store: jobStore, Executor: rename.Executor{Resolver: resolver}},
		SuperRenameRunner: superrename.Runner{
			Store:    jobStore,
			Executor: superrename.Executor{Resolver: resolver},
		},
	})

	log.Printf("FileButler listening on %s", cfg.Listen)
	if err := http.ListenAndServe(cfg.Listen, router); err != nil {
		log.Fatal(err)
	}
}
