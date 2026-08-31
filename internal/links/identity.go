package links

import "os"

type FileIdentity struct {
	VolumeID string
	ObjectID string
	Kind     SourceKind
}

func (identity FileIdentity) SameObject(other FileIdentity) bool {
	return identity.VolumeID != "" && identity.ObjectID != "" &&
		identity.VolumeID == other.VolumeID && identity.ObjectID == other.ObjectID && identity.Kind == other.Kind
}

func (identity FileIdentity) SameFilesystem(other FileIdentity) bool {
	return identity.VolumeID != "" && identity.VolumeID == other.VolumeID
}

func ReadIdentity(path string, follow bool) (FileIdentity, error) {
	var (
		info os.FileInfo
		err  error
	)
	if follow {
		info, err = os.Stat(path)
	} else {
		info, err = os.Lstat(path)
	}
	if err != nil {
		return FileIdentity{}, err
	}
	identity, err := platformIdentity(path, info, follow)
	if err != nil {
		return FileIdentity{}, err
	}
	identity.Kind = sourceKind(info)
	return identity, nil
}

func sourceKind(info os.FileInfo) SourceKind {
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		return SourceSymlink
	case info.IsDir():
		return SourceDirectory
	case info.Mode().IsRegular():
		return SourceFile
	default:
		return SourceOther
	}
}
