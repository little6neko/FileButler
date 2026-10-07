import { expect, it } from "vitest";
import { formatAppVersion } from "./version";

it.each<[string | undefined, string]>([
  ["v0.3.9", "v0.3.9"],
  ["0.3.9", "v0.3.9"],
  [" 1.2.3-beta.1 ", "v1.2.3-beta.1"],
  ["", "dev"],
  ["   ", "dev"],
  [undefined, "dev"],
])("formats build version %p as %s", (value, expected) => {
  expect(formatAppVersion(value)).toBe(expected);
});
