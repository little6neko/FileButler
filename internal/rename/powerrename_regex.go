package rename

import (
	"strconv"
	"strings"

	"github.com/dlclark/regexp2"
)

type PowerRenameRegexOptions struct {
	MatchAll      bool
	CaseSensitive bool
}

func powerRenameRegexReplace(source, search, replace string, opts PowerRenameRegexOptions) (string, bool, error) {
	regexOpts := regexp2.RegexOptions(regexp2.ECMAScript)
	if !opts.CaseSensitive {
		regexOpts |= regexp2.IgnoreCase
	}
	rx, err := regexp2.Compile(search, regexOpts)
	if err != nil {
		return "", false, err
	}
	sourceRunes := []rune(source)
	var out strings.Builder
	pos := 0
	matched := false
	for {
		match, err := rx.FindRunesMatchStartingAt(sourceRunes, pos)
		if err != nil {
			return "", false, err
		}
		if match == nil {
			out.WriteString(string(sourceRunes[pos:]))
			break
		}
		matched = true
		start := match.Index
		end := match.Index + match.Length
		out.WriteString(string(sourceRunes[pos:start]))
		out.WriteString(expandPowerRenameReplacement(replace, match))
		pos = end
		if !opts.MatchAll {
			out.WriteString(string(sourceRunes[pos:]))
			break
		}
		if match.Length == 0 {
			if pos >= len(sourceRunes) {
				break
			}
			out.WriteRune(sourceRunes[pos])
			pos++
		}
	}
	return out.String(), matched, nil
}

func expandPowerRenameReplacement(template string, match *regexp2.Match) string {
	var out strings.Builder
	for i := 0; i < len(template); i++ {
		if template[i] != '$' || i+1 >= len(template) {
			out.WriteByte(template[i])
			continue
		}
		next := template[i+1]
		if next == '$' {
			out.WriteByte('$')
			i++
			continue
		}
		if next >= '0' && next <= '9' {
			idx, _ := strconv.Atoi(string(next))
			if group := match.GroupByNumber(idx); group != nil && len(group.Captures) > 0 {
				out.WriteString(group.Capture.String())
			}
			i++
			continue
		}
		out.WriteByte(template[i])
	}
	return out.String()
}
