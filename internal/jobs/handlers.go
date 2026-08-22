package jobs

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const (
	sseRetryDelay        = 2000
	sseHeartbeatInterval = 15 * time.Second
)

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

func EventsHandler(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !store.Available() {
			writeError(w, http.StatusServiceUnavailable, "events_unavailable", "job events are unavailable")
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, http.StatusInternalServerError, "streaming_unsupported", "streaming is not supported")
			return
		}
		cursor := parseLastEventID(r.Header.Get("Last-Event-ID"))
		subscription, err := store.Subscribe(r.Context(), cursor)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "operation_failed", err.Error())
			return
		}
		defer subscription.Unsubscribe()

		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("X-Accel-Buffering", "no")
		if _, err := fmt.Fprintf(w, "retry: %d\n\n", sseRetryDelay); err != nil {
			return
		}
		flusher.Flush()
		lastCursor := int64(-1)
		if subscription.Snapshot != nil {
			lastCursor = subscription.Snapshot.Cursor
			if err := writeSSE(w, flusher, "jobs.snapshot", formatEventID(subscription.Snapshot.RuntimeID, subscription.Snapshot.Cursor), subscription.Snapshot); err != nil {
				return
			}
		}
		for _, event := range subscription.Replay {
			lastCursor = event.Cursor
			if err := writeSSE(w, flusher, "job.changed", formatEventID(event.RuntimeID, event.Cursor), event); err != nil {
				return
			}
		}

		heartbeat := time.NewTicker(sseHeartbeatInterval)
		defer heartbeat.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case event, ok := <-subscription.Events:
				if !ok {
					return
				}
				if event.Cursor <= lastCursor {
					continue
				}
				lastCursor = event.Cursor
				if err := writeSSE(w, flusher, "job.changed", formatEventID(event.RuntimeID, event.Cursor), event); err != nil {
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

func parseLastEventID(value string) *EventCursor {
	separator := strings.LastIndexByte(value, ':')
	if separator <= 0 || separator == len(value)-1 {
		return nil
	}
	runtimeID := value[:separator]
	cursorValue := value[separator+1:]
	for _, character := range cursorValue {
		if character < '0' || character > '9' {
			return nil
		}
	}
	cursor, err := strconv.ParseInt(cursorValue, 10, 64)
	if err != nil || cursor < 0 {
		return nil
	}
	return &EventCursor{RuntimeID: runtimeID, Cursor: cursor}
}

func formatEventID(runtimeID string, cursor int64) string {
	return runtimeID + ":" + strconv.FormatInt(cursor, 10)
}

func writeSSE(w http.ResponseWriter, flusher http.Flusher, eventName, id string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "id: %s\nevent: %s\ndata: %s\n\n", id, eventName, payload); err != nil {
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
