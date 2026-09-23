package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/browser"
	"github.com/little6neko/filebutler/internal/cloud115"
	"github.com/little6neko/filebutler/internal/config"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/links"
	"github.com/little6neko/filebutler/internal/ops"
	"github.com/little6neko/filebutler/internal/rename"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
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
	database, err := storage.Open(cfg.DatabaseFile)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()
	authService, err := auth.Open(database)
	if err != nil {
		log.Fatalf("load authentication: %v", err)
	}

	rootItems := make([]roots.Root, len(cfg.Roots))
	for i, root := range cfg.Roots {
		rootItems[i] = roots.Root{ID: root.ID, Name: root.Name, Path: root.Path}
	}
	resolver := roots.NewResolver(rootItems)
	jobStore := jobs.NewStore()
	cloudBridge := cloud115.NewBridge(cfg.Cloud115.Python, cfg.Cloud115.Worker, database, resolver)
	defer cloudBridge.Close()
	opsExecutor := ops.Executor{Resolver: resolver, Cache: database}
	linkStaging := links.NewStagingManager(jobStore.RuntimeID())
	linkMaintainer := links.StagingMaintainer{Manager: linkStaging, Jobs: jobStore}
	linkPlanner := links.Planner{Resolver: resolver, Maintainer: linkMaintainer}
	linkBrowser := browser.Service{Resolver: resolver, Maintainer: linkMaintainer}
	router := web.NewRouter(web.Deps{
		Database:     database,
		Cloud115:     cloud115.NewService(cloudBridge, jobStore, resolver),
		Config:       cfg,
		Auth:         authService,
		Roots:        resolver,
		Browser:      linkBrowser,
		OpsPlanner:   ops.Planner{Resolver: resolver},
		JobStore:     jobStore,
		OpsRunner:    jobs.Runner{Store: jobStore, Executor: ops.JobExecutor{Executor: opsExecutor}},
		RenameRunner: jobs.Runner{Store: jobStore, Executor: rename.Executor{Resolver: resolver, Cache: database}},
		SuperRenameRunner: superrename.Runner{
			Store:    jobStore,
			Executor: superrename.Executor{Resolver: resolver, Cache: database},
		},
		LinkPlanner: linkPlanner,
		LinkRunner: links.Runner{
			Store: jobStore,
			Executor: links.Executor{
				Planner: linkPlanner,
				Staging: linkStaging,
			},
		},
	})

	log.Printf("FileButler listening on %s", cfg.Listen)
	if err := http.ListenAndServe(cfg.Listen, router); err != nil {
		log.Fatal(err)
	}
}
