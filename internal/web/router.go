package web

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/browser"
	"github.com/little6neko/filebutler/internal/cloud115"
	"github.com/little6neko/filebutler/internal/config"
	"github.com/little6neko/filebutler/internal/details"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/links"
	"github.com/little6neko/filebutler/internal/ops"
	"github.com/little6neko/filebutler/internal/rename"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
	"github.com/little6neko/filebutler/internal/superrename"
	"github.com/little6neko/filebutler/internal/textfile"
)

type Deps struct {
	Database          *storage.Store
	Cloud115          *cloud115.Service
	Config            config.Config
	Auth              *auth.Service
	Roots             roots.Resolver
	Browser           browser.Service
	OpsPlanner        ops.Planner
	JobStore          jobs.Store
	OpsRunner         jobs.Runner
	RenameRunner      jobs.Runner
	SuperRenameRunner superrename.Runner
	LinkPlanner       links.Planner
	LinkRunner        links.Runner
}

func NewRouter(deps Deps) http.Handler {
	router := chi.NewRouter()
	textService := textfile.NewService(deps.Roots)
	textService.Cache = deps.Database
	superRenameScanner := superrename.Scanner{Resolver: deps.Roots}
	superRenameRunner := deps.SuperRenameRunner
	superRenameRunner.Store = deps.JobStore
	if superRenameRunner.Executor == nil {
		superRenameRunner.Executor = superrename.Executor{Resolver: deps.Roots}
	}
	linkRunner := deps.LinkRunner
	linkRunner.Store = deps.JobStore
	cookieName := deps.Config.Session.CookieName
	if cookieName == "" {
		cookieName = "filebutler_session"
	}
	router.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		Data(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/api/init/status", auth.InitStatusHandler(deps.Auth))
	router.Post("/api/init/admin", auth.CreateAdminHandler(deps.Auth))
	router.Post("/api/auth/login", auth.LoginHandler(deps.Auth, cookieName, deps.Config.Session.Secure))
	router.Post("/api/auth/logout", auth.LogoutHandler(cookieName, deps.Config.Session.Secure))
	router.Get("/api/auth/me", auth.MeHandler(deps.Auth, cookieName))

	router.Group(func(protected chi.Router) {
		protected.Use(auth.RequireAuth(deps.Auth, cookieName))
		if deps.Cloud115 != nil {
			protected.Post("/api/cloud115/{method}", deps.Cloud115.Handler)
		}
		protected.Get("/api/roots", rootsHandler(deps.Roots))
		protected.Get("/api/browse", browseHandler(deps.Browser))
		protected.Post("/api/details/{section}", detailsHandler(details.Service{Roots: deps.Roots, DB: deps.Database}))
		protected.Get("/api/media", mediaHandler(deps.Roots))
		protected.Get("/api/text", textReadHandler(textService))
		protected.Put("/api/text", textSaveHandler(textService))
		protected.Post("/api/ops/dry-run", ops.DryRunHandler(deps.OpsPlanner))
		protected.Post("/api/ops/jobs", ops.CreateJobHandler(deps.OpsPlanner, deps.JobStore, deps.OpsRunner))
		protected.Post("/api/rename/preview", rename.PreviewHandler(deps.Browser))
		protected.Post("/api/rename/jobs", rename.CreateJobHandler(deps.Browser, deps.JobStore, deps.RenameRunner))
		protected.Post("/api/rename/single/jobs", rename.SingleRenameCreateJobHandler(deps.Browser, deps.JobStore, deps.RenameRunner))
		protected.Post("/api/super-rename/preview", superrename.PreviewHandler(superRenameScanner))
		protected.Post("/api/super-rename/group-preview", superrename.GroupPreviewHandler(superRenameScanner))
		protected.Post("/api/super-rename/jobs", superrename.CreateJobHandler(superRenameScanner, superrename.Planner{}, deps.JobStore, superRenameRunner))
		protected.Post("/api/links/preview", links.PreviewHandler(deps.LinkPlanner))
		protected.Post("/api/links/jobs", links.CreateJobHandler(deps.LinkPlanner, deps.JobStore, linkRunner))
		protected.Get("/api/jobs/events", jobs.EventsHandler(deps.JobStore))
		protected.Post("/api/jobs/{id}/cancel", jobs.CancelHandler(deps.JobStore))
	})
	router.Handle("/*", StaticHandler(deps.Config.StaticDir))
	return router
}

func rootsHandler(resolver roots.Resolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rootsList := resolver.List()
		out := make([]roots.Root, len(rootsList))
		for i, root := range rootsList {
			out[i] = roots.Root{ID: root.ID, Name: root.Name}
		}
		Data(w, http.StatusOK, out)
	}
}

func browseHandler(service browser.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		entries, err := service.List(r.Context(), r.URL.Query().Get("rootId"), r.URL.Query().Get("path"))
		if err != nil {
			Error(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		Data(w, http.StatusOK, entries)
	}
}
