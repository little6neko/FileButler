//go:build !linux

package extract

import "os"

const helperArgument = "--internal-archive-reader"

func RunHelper() {
	if len(os.Args) > 1 && os.Args[1] == helperArgument {
		os.Exit(125)
	}
}
