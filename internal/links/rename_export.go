package links

// RenameNoReplace moves a path without replacing an existing destination.
func RenameNoReplace(source, destination string) error {
	return renameNoReplace(source, destination)
}
