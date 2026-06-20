package rename

import (
	"strings"
	"unicode"
)

func powerRenameUppercase(input string) string {
	return strings.ToUpper(input)
}

func powerRenameLowercase(input string) string {
	return strings.ToLower(input)
}

func powerRenameTitlecase(input string) string {
	return strings.Title(strings.ToLower(input))
}

func powerRenameCapitalized(input string) string {
	lower := strings.ToLower(input)
	runes := []rune(lower)
	for i, r := range runes {
		if unicode.IsLetter(r) {
			runes[i] = unicode.ToUpper(r)
			break
		}
	}
	return string(runes)
}
