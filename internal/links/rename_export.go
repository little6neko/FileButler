package links

// RenameNoReplace moves a path without replacing an existing destination.
// On filesystems lacking native no-replace support, the compatibility check
// protects calls through this helper, not concurrent writes by other callers.
func RenameNoReplace(source, destination string) error {
	return renameNoReplace(source, destination)
}
