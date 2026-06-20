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
