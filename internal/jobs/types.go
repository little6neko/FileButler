package jobs

type Status string

const (
	StatusPending             Status = "pending"
	StatusRunning             Status = "running"
	StatusCancelRequested     Status = "cancel_requested"
	StatusCompleted           Status = "completed"
	StatusCompletedWithErrors Status = "completed_with_errors"
	StatusFailed              Status = "failed"
	StatusCanceled            Status = "canceled"
)

type Job struct {
	Transfer        *TransferProgress `json:"transfer,omitempty"`
	ID              string            `json:"id"`
	Type            string            `json:"type"`
	Status          Status            `json:"status"`
	ActorID         int64             `json:"actorId"`
	SourceRootID    string            `json:"sourceRootId"`
	DestRootID      string            `json:"destRootId,omitempty"`
	ProgressTotal   int               `json:"progressTotal"`
	ProgressDone    int               `json:"progressDone"`
	FailedCount     int               `json:"failedCount"`
	CancelRequested bool              `json:"cancelRequested"`
	ErrorMessage    string            `json:"errorMessage"`
	CreatedAtUnix   int64             `json:"createdAtUnix"`
	UpdatedAtUnix   int64             `json:"updatedAtUnix"`
	FinishedAtUnix  int64             `json:"finishedAtUnix,omitempty"`
	EventVersion    int64             `json:"eventVersion"`
}
type Snapshot struct {
	RuntimeID string `json:"runtimeId"`
	Cursor    int64  `json:"cursor"`
	Reset     bool   `json:"reset"`
	Jobs      []Job  `json:"jobs"`
}

func (s Status) IsTerminal() bool {
	switch s {
	case StatusCompleted, StatusCompletedWithErrors, StatusFailed, StatusCanceled:
		return true
	default:
		return false
	}
}
