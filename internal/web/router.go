package web

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/audit"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/browser"
	"github.com/little6neko/filebutler/internal/config"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/ops"
	"github.com/little6neko/filebutler/internal/rename"
	"github.com/little6neko/filebutler/internal/roots"
)

type Deps struct {
	Config       config.Config
	Auth         auth.Service
	Roots        roots.Resolver
	Browser      browser.Service
	OpsPlanner   ops.Planner
	RenameStore  jobs.Store
	JobStore     jobs.Store
	AuditStore   audit.Store
	OpsRunner    jobs.Runner
	RenameRunner jobs.Runner
}

func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()
	cookieName := deps.Config.Session.CookieName
	if cookieName == "" {
		cookieName = "filebutler_session"
	}
	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		Data(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/api/init/status", auth.InitStatusHandler(deps.Auth))
	r.Post("/api/init/admin", auth.CreateAdminHandler(deps.Auth))
	r.Post("/api/auth/login", auth.LoginHandler(deps.Auth, cookieName, deps.Config.Session.Secure))
	r.Post("/api/auth/logout", auth.LogoutHandler(deps.Auth, cookieName))
	r.Get("/api/auth/me", auth.MeHandler(deps.Auth, cookieName))

	r.Group(func(protected chi.Router) {
		protected.Use(auth.RequireAuth(deps.Auth, cookieName))
		protected.Get("/api/roots", rootsHandler(deps.Roots))
		protected.Get("/api/browse", browseHandler(deps.Browser))
		protected.Post("/api/ops/dry-run", ops.DryRunHandler(deps.OpsPlanner))
		protected.Post("/api/ops/jobs", ops.CreateJobHandler(deps.OpsPlanner, deps.JobStore, deps.OpsRunner))
		protected.Post("/api/rename/preview", rename.PreviewHandler(deps.Browser))
		protected.Post("/api/rename/jobs", rename.CreateJobHandler(deps.Browser, deps.JobStore, deps.RenameRunner))
		protected.Post("/api/rename/single/jobs", rename.SingleRenameCreateJobHandler(deps.Browser, deps.JobStore, deps.RenameRunner))
		protected.Get("/api/jobs", jobs.ListHandler(deps.JobStore))
		protected.Get("/api/jobs/{id}", jobs.GetHandler(deps.JobStore))
		protected.Post("/api/jobs/{id}/cancel", jobs.CancelHandler(deps.JobStore))
		protected.Get("/api/audit", auditHandler(deps.AuditStore))
	})
	r.Handle("/*", StaticHandler(deps.Config.StaticDir))
	return r
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

func auditHandler(store audit.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		records, err := store.List(r.Context(), 50)
		if err != nil {
			Error(w, http.StatusInternalServerError, "operation_failed", err.Error())
			return
		}
		Data(w, http.StatusOK, records)
	}
}
