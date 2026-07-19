import { expect, it } from "vitest";
import { buildPathSegments, fitPathSegments } from "./pathSegments";

const segments = [
  { label: "/", path: "." },
  { label: "Games", path: "Games" },
  { label: "Unity翻译", path: "Games/Unity翻译" },
  { label: "Projects", path: "Games/Unity翻译/Projects" },
  { label: "FileButler", path: "Games/Unity翻译/Projects/FileButler" },
  { label: "web", path: "Games/Unity翻译/Projects/FileButler/web" },
  { label: "components", path: "Games/Unity翻译/Projects/FileButler/web/components" },
];
const widths = [14, 52, 72, 68, 74, 30, 70];

it("keeps every segment when the complete path fits", () => {
  const result = fitPathSegments(segments, widths, 8, 24, 900);

  expect(result.visible.map((item) => item.label)).toEqual([
    "/",
    "Games",
    "Unity翻译",
    "Projects",
    "FileButler",
    "web",
    "components",
  ]);
  expect(result.hidden).toEqual([]);
});

it("keeps the newest ancestors first when the middle no longer fits", () => {
  const result = fitPathSegments(segments, widths, 8, 24, 330);

  expect(result.visible.map((item) => item.label)).toEqual(["/", "Games", "FileButler", "web", "components"]);
  expect(result.hidden.map((item) => item.label)).toEqual(["Unity翻译", "Projects"]);
});

it("uses the exact width boundary without dropping a complete label", () => {
  const exact = fitPathSegments(segments, widths, 8, 24, 304);
  const tooNarrow = fitPathSegments(segments, widths, 8, 24, 303);

  expect(exact.visible.map((item) => item.label)).toEqual(["/", "Games", "FileButler", "web", "components"]);
  expect(tooNarrow.visible.map((item) => item.label)).toEqual(["/", "Games", "web", "components"]);
  expect(tooNarrow.hidden.map((item) => item.label)).toEqual(["Unity翻译", "Projects", "FileButler"]);
});

it("keeps the fixed items when no middle ancestor can fit", () => {
  const result = fitPathSegments(segments, widths, 8, 24, 184);

  expect(result.visible.map((item) => item.label)).toEqual(["/", "Games", "components"]);
  expect(result.hidden.map((item) => item.label)).toEqual(["Unity翻译", "Projects", "FileButler", "web"]);
});

it("does not add an overflow control for short paths", () => {
  expect(fitPathSegments(buildPathSegments("."), [14], 8, 24, 20).hidden).toEqual([]);
  expect(fitPathSegments(buildPathSegments("Games"), [14, 52], 8, 24, 20).hidden).toEqual([]);
  expect(fitPathSegments(buildPathSegments("Games/Unity翻译"), [14, 52, 72], 8, 24, 20).hidden).toEqual([]);
});

it("builds accumulated paths for each directory segment", () => {
  expect(buildPathSegments("/Games/Unity翻译/Projects")).toEqual([
    { label: "/", path: "." },
    { label: "Games", path: "Games" },
    { label: "Unity翻译", path: "Games/Unity翻译" },
    { label: "Projects", path: "Games/Unity翻译/Projects" },
  ]);
});
