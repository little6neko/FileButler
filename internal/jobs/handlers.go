package jobs

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

const (
	sseRetryDelay        = 2000
	sseHeartbeatInterval = 15 * time.Second
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

func EventsHandler(store Store, broker *Broker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if broker == nil {
			writeError(w, http.StatusServiceUnavailable, "events_unavailable", "job events are unavailable")
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, http.StatusInternalServerError, "streaming_unsupported", "streaming is not supported")
			return
		}

		lastEventID := parseLastEventID(r.Header.Get("Last-Event-ID"))
		events, unsubscribe := broker.Subscribe()
		defer unsubscribe()
		snapshot, err := store.Snapshot(r.Context(), lastEventID, 50)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "operation_failed", err.Error())
			return
		}

		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("X-Accel-Buffering", "no")
		if _, err := fmt.Fprintf(w, "retry: %d\n\n", sseRetryDelay); err != nil {
			return
		}
		flusher.Flush()
		if err := writeSSE(w, flusher, "jobs.snapshot", snapshot.Cursor, struct {
			Cursor int64 `json:"cursor"`
			Jobs   []Job `json:"jobs"`
		}{Cursor: snapshot.Cursor, Jobs: snapshot.Jobs}); err != nil {
			return
		}

		heartbeat := time.NewTicker(sseHeartbeatInterval)
		defer heartbeat.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case event, ok := <-events:
				if !ok {
					return
				}
				if event.Job.EventVersion <= snapshot.Cursor {
					continue
				}
				if err := writeSSE(w, flusher, "job.changed", event.Job.EventVersion, event); err != nil {
					return
				}
			case <-heartbeat.C:
				if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	}
}

func parseLastEventID(value string) *int64 {
	if value == "" {
		return nil
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return nil
		}
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed < 0 {
		return nil
	}
	return &parsed
}

func writeSSE(w http.ResponseWriter, flusher http.Flusher, eventName string, id int64, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", id, eventName, payload); err != nil {
		return err
	}
	flusher.Flush()
	return nil
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
