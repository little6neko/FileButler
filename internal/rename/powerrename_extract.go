package rename

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/rwcarlsen/goexif/exif"
)

func buildPowerRenameTemplateContext(absPath string) PowerRenameTemplateContext {
	ctx := PowerRenameTemplateContext{Metadata: map[string]string{}}
	info, err := os.Stat(absPath)
	if err == nil {
		ctx.ModifiedTime = info.ModTime()
		ctx.CreationTime = info.ModTime()
		ctx.AccessTime = info.ModTime()
		if stat, ok := info.Sys().(*syscall.Stat_t); ok {
			ctx.AccessTime = time.Unix(stat.Atim.Sec, stat.Atim.Nsec)
			ctx.CreationTime = time.Unix(stat.Ctim.Sec, stat.Ctim.Nsec)
		}
	}
	if file, err := os.Open(absPath); err == nil {
		defer file.Close()
		for key, value := range extractPowerRenameEXIFPatterns(file) {
			ctx.Metadata[key] = sanitizePowerRenameMetadataValue(value)
		}
	}
	if raw, err := os.ReadFile(absPath); err == nil {
		for key, value := range extractPowerRenameXMPPatterns(raw) {
			ctx.Metadata[key] = sanitizePowerRenameMetadataValue(value)
		}
	}
	return ctx
}

func extractPowerRenameEXIFPatterns(reader io.Reader) map[string]string {
	x, err := exif.Decode(reader)
	if err != nil {
		return map[string]string{}
	}
	out := map[string]string{}
	exifString := func(name exif.FieldName, key string) {
		tag, err := x.Get(name)
		if err != nil {
			return
		}
		if value, err := tag.StringVal(); err == nil {
			out[key] = strings.TrimSpace(value)
			return
		}
		out[key] = trimPowerRenameEXIFString(tag.String())
	}
	exifString(exif.Make, "CAMERA_MAKE")
	exifString(exif.Model, "CAMERA_MODEL")
	exifString(exif.LensModel, "LENS")
	exifString(exif.Artist, "AUTHOR")
	exifString(exif.Copyright, "COPYRIGHT")
	exifString(exif.ImageWidth, "WIDTH")
	exifString(exif.ImageLength, "HEIGHT")
	exifString(exif.PixelYDimension, "HEIGHT")
	exifString(exif.ExposureBiasValue, "EXPOSURE_BIAS")
	exifString(exif.Orientation, "ORIENTATION")
	exifString(exif.ColorSpace, "COLOR_SPACE")
	exifString(exif.GPSAltitude, "ALTITUDE")
	if tag, err := x.Get(exif.ISOSpeedRatings); err == nil {
		out["ISO"] = "ISO " + trimPowerRenameEXIFString(tag.String())
	}
	if lat, long, err := x.LatLong(); err == nil {
		out["LATITUDE"] = fmt.Sprintf("%.6f", lat)
		out["LONGITUDE"] = fmt.Sprintf("%.6f", long)
	}
	if tm, err := x.DateTime(); err == nil {
		addPowerRenameDateParts(out, "DATE_TAKEN", tm)
	}
	return out
}

func extractPowerRenameXMPPatterns(raw []byte) map[string]string {
	out := map[string]string{}
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	var stack []string
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := token.(type) {
		case xml.StartElement:
			stack = append(stack, t.Name.Local)
			for _, attr := range t.Attr {
				switch attr.Name.Local {
				case "CreatorTool":
					out["CREATOR_TOOL"] = attr.Value
				case "CreateDate":
					addParsedPowerRenameDate(out, "CREATE_DATE", attr.Value)
				case "DocumentID":
					out["DOCUMENT_ID"] = attr.Value
				case "InstanceID":
					out["INSTANCE_ID"] = attr.Value
				case "OriginalDocumentID":
					out["ORIGINAL_DOCUMENT_ID"] = attr.Value
				case "VersionID":
					out["VERSION_ID"] = attr.Value
				}
			}
		case xml.CharData:
			text := strings.TrimSpace(string(t))
			if text == "" {
				continue
			}
			path := strings.Join(stack, "/")
			switch {
			case strings.Contains(path, "title/Alt/li"):
				out["TITLE"] = text
			case strings.Contains(path, "description/Alt/li"):
				out["DESCRIPTION"] = text
			case strings.Contains(path, "creator/Seq/li"):
				out["CREATOR"] = text
				out["AUTHOR"] = text
			case strings.Contains(path, "subject/Bag/li"):
				if out["SUBJECT"] == "" {
					out["SUBJECT"] = text
				} else {
					out["SUBJECT"] += "; " + text
				}
			case strings.Contains(path, "WebStatement"):
				out["RIGHTS"] = text
				out["COPYRIGHT"] = text
			}
		case xml.EndElement:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}
	return out
}

func addParsedPowerRenameDate(out map[string]string, prefix string, value string) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
		if tm, err := time.Parse(layout, value); err == nil {
			addPowerRenameDateParts(out, prefix, tm)
			return
		}
	}
}

func addPowerRenameDateParts(out map[string]string, prefix string, tm time.Time) {
	out[prefix+"_YYYY"] = tm.Format("2006")
	out[prefix+"_YY"] = tm.Format("06")
	out[prefix+"_MM"] = tm.Format("01")
	out[prefix+"_DD"] = tm.Format("02")
	out[prefix+"_HH"] = tm.Format("15")
	out[prefix+"_mm"] = tm.Format("04")
	out[prefix+"_SS"] = tm.Format("05")
}

func sanitizePowerRenameMetadataValue(value string) string {
	replacer := strings.NewReplacer("<", "", ">", "", ":", "", "\"", "", "/", "", "\\", "", "|", "", "?", "", "*", "")
	return strings.TrimSpace(replacer.Replace(value))
}

func trimPowerRenameEXIFString(value string) string {
	return strings.Trim(strings.TrimSpace(value), `"`)
}
