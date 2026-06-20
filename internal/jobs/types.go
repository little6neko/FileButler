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
	ID               string `json:"id"`
	Type             string `json:"type"`
	Status           Status `json:"status"`
	ActorID          int64  `json:"actorId"`
	SourceRootID     string `json:"sourceRootId"`
	DestRootID       string `json:"destRootId,omitempty"`
	PlanJSON         string `json:"-"`
	RootSnapshotJSON string `json:"-"`
	ProgressTotal    int    `json:"progressTotal"`
	ProgressDone     int    `json:"progressDone"`
	CancelRequested  bool   `json:"cancelRequested"`
	ErrorMessage     string `json:"errorMessage"`
	CreatedAtUnix    int64  `json:"createdAtUnix"`
	UpdatedAtUnix    int64  `json:"updatedAtUnix"`
	FinishedAtUnix   int64  `json:"finishedAtUnix,omitempty"`
}

type ItemResult struct {
	JobID        string `json:"-"`
	Index        int    `json:"index"`
	SourcePath   string `json:"sourcePath"`
	DestPath     string `json:"destPath,omitempty"`
	Status       string `json:"status"`
	ErrorCode    string `json:"errorCode"`
	ErrorMessage string `json:"errorMessage"`
	UndoJSON     string `json:"-"`
}
