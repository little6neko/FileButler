package rename

import "testing"

func TestPowerRenameTransforms(t *testing.T) {
	cases := []struct {
		name string
		fn   func(string) string
		want string
	}{
		{"upper", powerRenameUppercase, "HELLO WORLD"},
		{"lower", powerRenameLowercase, "hello world"},
		{"title", powerRenameTitlecase, "Hello World"},
		{"capitalized", powerRenameCapitalized, "Hello world"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.fn("hello WORLD"); got != tc.want {
				t.Fatalf("got=%q want=%q", got, tc.want)
			}
		})
	}
}
