package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/little6neko/filebutler/internal/audit"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/browser"
	"github.com/little6neko/filebutler/internal/config"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/ops"
	"github.com/little6neko/filebutler/internal/rename"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/store"
	"github.com/little6neko/filebutler/internal/web"
)

func main() {
	configPath := flag.String("config", "configs/filebutler.example.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	db, err := store.Open(context.Background(), cfg.DatabasePath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	rootItems := make([]roots.Root, len(cfg.Roots))
	for i, root := range cfg.Roots {
		rootItems[i] = roots.Root{ID: root.ID, Name: root.Name, Path: root.Path}
	}
	resolver := roots.NewResolver(rootItems)
	authService := auth.Service{
		DB:            db,
		SessionMaxAge: time.Duration(cfg.Session.MaxAgeSeconds) * time.Second,
	}
	jobStore := jobs.Store{DB: db}
	auditStore := audit.Store{DB: db}
	opsExecutor := ops.Executor{Resolver: resolver}
	r := web.NewRouter(web.Deps{
		Config:       cfg,
		Auth:         authService,
		Roots:        resolver,
		Browser:      browser.Service{Resolver: resolver},
		OpsPlanner:   ops.Planner{Resolver: resolver},
		JobStore:     jobStore,
		AuditStore:   auditStore,
		OpsRunner:    jobs.Runner{Store: jobStore, Audit: auditStore, Executor: ops.JobExecutor{Executor: opsExecutor}},
		RenameRunner: jobs.Runner{Store: jobStore, Audit: auditStore, Executor: rename.Executor{Resolver: resolver}},
	})

	log.Printf("FileButler listening on %s", cfg.Listen)
	if err := http.ListenAndServe(cfg.Listen, r); err != nil {
		log.Fatal(err)
	}
}
