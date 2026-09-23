//go:build !linux

package details

func birthTime(string) *int64 { return nil }
