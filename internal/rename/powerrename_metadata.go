package rename

import (
	"regexp"
	"strings"
	"time"
)

type PowerRenameTemplateContext struct {
	CreationTime time.Time
	ModifiedTime time.Time
	AccessTime   time.Time
	Metadata     map[string]string
}

var powerRenameTemplateRegex = regexp.MustCompile(`\$\{([^}]+)\}`)

func renderPowerRenameMetadataTemplates(input string, ctx PowerRenameTemplateContext) string {
	return powerRenameTemplateRegex.ReplaceAllStringFunc(input, func(token string) string {
		body := strings.TrimSuffix(strings.TrimPrefix(token, "${"), "}")
		if value, ok := ctx.Metadata[body]; ok {
			return value
		}
		key, format, ok := strings.Cut(body, ":")
		if !ok {
			return token
		}
		switch strings.ToLower(key) {
		case "creationtime":
			return formatPowerRenameTime(ctx.CreationTime, format)
		case "modifiedtime":
			return formatPowerRenameTime(ctx.ModifiedTime, format)
		case "accesstime":
			return formatPowerRenameTime(ctx.AccessTime, format)
		default:
			return token
		}
	})
}

func powerRenameTemplateContextModeForReplacement(input string) powerRenameTemplateContextMode {
	var mode powerRenameTemplateContextMode
	for _, match := range powerRenameTemplateRegex.FindAllStringSubmatch(input, -1) {
		if len(match) < 2 {
			continue
		}
		body := match[1]
		key, _, hasFormat := strings.Cut(body, ":")
		if hasFormat {
			switch strings.ToLower(key) {
			case "creationtime", "modifiedtime", "accesstime":
				mode |= powerRenameTemplateContextTimes
				continue
			}
		}
		if _, ok := powerRenameMetadataTokenKeys[body]; ok {
			mode |= powerRenameTemplateContextMetadata
		}
	}
	return mode
}

var powerRenameMetadataTokenKeys = map[string]struct{}{
	"CAMERA_MAKE":          {},
	"CAMERA_MODEL":         {},
	"LENS":                 {},
	"AUTHOR":               {},
	"COPYRIGHT":            {},
	"WIDTH":                {},
	"HEIGHT":               {},
	"EXPOSURE_BIAS":        {},
	"ORIENTATION":          {},
	"COLOR_SPACE":          {},
	"ALTITUDE":             {},
	"ISO":                  {},
	"LATITUDE":             {},
	"LONGITUDE":            {},
	"DATE_TAKEN_YYYY":      {},
	"DATE_TAKEN_YY":        {},
	"DATE_TAKEN_MM":        {},
	"DATE_TAKEN_DD":        {},
	"DATE_TAKEN_HH":        {},
	"DATE_TAKEN_mm":        {},
	"DATE_TAKEN_SS":        {},
	"CREATOR_TOOL":         {},
	"CREATE_DATE_YYYY":     {},
	"CREATE_DATE_YY":       {},
	"CREATE_DATE_MM":       {},
	"CREATE_DATE_DD":       {},
	"CREATE_DATE_HH":       {},
	"CREATE_DATE_mm":       {},
	"CREATE_DATE_SS":       {},
	"DOCUMENT_ID":          {},
	"INSTANCE_ID":          {},
	"ORIGINAL_DOCUMENT_ID": {},
	"VERSION_ID":           {},
	"TITLE":                {},
	"DESCRIPTION":          {},
	"CREATOR":              {},
	"SUBJECT":              {},
	"RIGHTS":               {},
}

func formatPowerRenameTime(t time.Time, format string) string {
	replacer := strings.NewReplacer(
		"yyyy", "2006",
		"yy", "06",
		"MM", "01",
		"dd", "02",
		"HH", "15",
		"mm", "04",
		"ss", "05",
	)
	return t.Format(replacer.Replace(format))
}
