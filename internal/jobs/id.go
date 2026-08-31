package jobs

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"sync/atomic"
	"time"
)

var fallbackIDCounter atomic.Uint64

func NewID() string {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		seed := strconv.FormatInt(time.Now().UnixNano(), 10) + ":" + strconv.FormatUint(fallbackIDCounter.Add(1), 10)
		digest := sha256.Sum256([]byte(seed))
		raw = digest[:16]
	}
	return "job_" + hex.EncodeToString(raw)
}
