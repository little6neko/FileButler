package rename

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

type powerRenameRandom interface {
	alpha(int) string
	digit(int) string
	alnum(int) string
	uuidv4() string
}

type cryptoPowerRenameRandom struct{}
type deterministicRandom struct{}

func renderPowerRenameTokens(input string, itemIndex int, random powerRenameRandom) (string, bool, error) {
	if random == nil {
		random = cryptoPowerRenameRandom{}
	}
	var out strings.Builder
	changed := false
	for i := 0; i < len(input); {
		if !strings.HasPrefix(input[i:], "${") {
			out.WriteByte(input[i])
			i++
			continue
		}
		end := strings.Index(input[i+2:], "}")
		if end < 0 {
			out.WriteByte(input[i])
			i++
			continue
		}
		body := input[i+2 : i+2+end]
		value, ok, err := renderPowerRenameTokenBody(body, itemIndex, random)
		if err != nil {
			return "", false, err
		}
		if ok {
			out.WriteString(value)
			changed = true
		} else {
			out.WriteString("${")
			out.WriteString(body)
			out.WriteString("}")
		}
		i += end + 3
	}
	return out.String(), changed, nil
}

func renderPowerRenameTokenBody(body string, itemIndex int, random powerRenameRandom) (string, bool, error) {
	if body == "" || strings.Contains(body, "start=") || strings.Contains(body, "increment=") || strings.Contains(body, "padding=") {
		start, inc, padding := 1, 1, 0
		for _, part := range strings.Split(body, ";") {
			key, value, ok := strings.Cut(part, "=")
			if !ok || key == "" {
				continue
			}
			n, err := strconv.Atoi(value)
			if err != nil {
				return "", false, err
			}
			switch key {
			case "start":
				start = n
			case "increment":
				inc = n
			case "padding":
				padding = n
			}
		}
		n := start + ((itemIndex - 1) * inc)
		if padding > 0 {
			return fmt.Sprintf("%0*d", padding, n), true, nil
		}
		return strconv.Itoa(n), true, nil
	}
	if n, ok := tokenInt(body, "rstringalpha="); ok {
		return random.alpha(n), true, nil
	}
	if n, ok := tokenInt(body, "rstringdigit="); ok {
		return random.digit(n), true, nil
	}
	if n, ok := tokenInt(body, "rstringalnum="); ok {
		return random.alnum(n), true, nil
	}
	if body == "ruuidv4" {
		return random.uuidv4(), true, nil
	}
	return "", false, nil
}

func tokenInt(body, prefix string) (int, bool) {
	if !strings.HasPrefix(body, prefix) {
		return 0, false
	}
	n, err := strconv.Atoi(strings.TrimPrefix(body, prefix))
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

func (cryptoPowerRenameRandom) alpha(n int) string {
	return randomFromAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", n)
}

func (cryptoPowerRenameRandom) digit(n int) string {
	return randomFromAlphabet("0123456789", n)
}

func (cryptoPowerRenameRandom) alnum(n int) string {
	return randomFromAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", n)
}

func (cryptoPowerRenameRandom) uuidv4() string {
	return uuid.NewString()
}

func randomFromAlphabet(alphabet string, n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		idx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		b.WriteByte(alphabet[idx.Int64()])
	}
	return b.String()
}

func (deterministicRandom) alpha(n int) string {
	return strings.Repeat("A", n)
}

func (deterministicRandom) digit(n int) string {
	return strings.Repeat("1", n)
}

func (deterministicRandom) alnum(n int) string {
	return strings.Repeat("B", n)
}

func (deterministicRandom) uuidv4() string {
	return "00000000-0000-4000-8000-000000000000"
}
