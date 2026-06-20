package jobs

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func ListHandler(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jobs, err := store.List(r.Context(), 50)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "operation_failed", err.Error())
			return
		}
		writeData(w, http.StatusOK, jobs)
	}
}

func GetHandler(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		job, items, err := store.Get(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusNotFound, "not_found", "job not found")
			return
		}
		writeData(w, http.StatusOK, struct {
			Job
			Items []ItemResult `json:"items"`
		}{Job: job, Items: items})
	}
}

func CancelHandler(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if err := store.RequestCancel(r.Context(), id); err != nil {
			writeError(w, http.StatusInternalServerError, "operation_failed", err.Error())
			return
		}
		writeData(w, http.StatusOK, map[string]string{"id": id})
	}
}

func writeData(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": value})
}

func writeError(w http.ResponseWriter, status int, code string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}
