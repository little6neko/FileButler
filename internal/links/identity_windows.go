//go:build windows

package links

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func platformIdentity(path string, _ os.FileInfo, follow bool) (FileIdentity, error) {
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return FileIdentity{}, err
	}
	flags := uint32(windows.FILE_FLAG_BACKUP_SEMANTICS)
	if !follow {
		flags |= windows.FILE_FLAG_OPEN_REPARSE_POINT
	}
	handle, err := windows.CreateFile(
		pathPointer,
		windows.FILE_READ_ATTRIBUTES,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		flags,
		0,
	)
	if err != nil {
		return FileIdentity{}, err
	}
	defer windows.CloseHandle(handle)

	var information windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &information); err != nil {
		return FileIdentity{}, err
	}
	return FileIdentity{
		VolumeID: fmt.Sprintf("volume:%08x", information.VolumeSerialNumber),
		ObjectID: fmt.Sprintf("file:%08x%08x", information.FileIndexHigh, information.FileIndexLow),
	}, nil
}
