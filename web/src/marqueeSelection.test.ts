import { expect, it } from "vitest";
import { pathsInsideMarquee, type MarqueeGeometry } from "./marqueeSelection";

const geometry: MarqueeGeometry = {
  contentLeft: 20,
  contentRight: 420,
  rows: [
    { path: "a.txt", top: 32, bottom: 64 },
    { path: "b.txt", top: 72, bottom: 104 },
    { path: "c.txt", top: 112, bottom: 144 },
    { path: "d.txt", top: 152, bottom: 184 },
  ],
};

it("finds the ordered row interval for forward and reverse marquee gestures", () => {
  expect(pathsInsideMarquee(geometry, 30, 40, 300, 130)).toEqual(["a.txt", "b.txt", "c.txt"]);
  expect(pathsInsideMarquee(geometry, 300, 130, 30, 40)).toEqual(["a.txt", "b.txt", "c.txt"]);
});

it("excludes rows at edge-only contact and while the marquee is in a row gap", () => {
  expect(pathsInsideMarquee(geometry, 30, 64, 300, 72)).toEqual([]);
  expect(pathsInsideMarquee(geometry, 30, 40, 300, 72)).toEqual(["a.txt"]);
  expect(pathsInsideMarquee(geometry, 30, 104, 300, 112)).toEqual([]);
  expect(pathsInsideMarquee(geometry, 30, 104, 300, 144)).toEqual(["c.txt"]);
});

it("rejects a marquee with no horizontal overlap", () => {
  expect(pathsInsideMarquee(geometry, -100, 40, 20, 170)).toEqual([]);
  expect(pathsInsideMarquee(geometry, 420, 40, 500, 170)).toEqual([]);
  expect(pathsInsideMarquee(geometry, 100, 40, 100, 170)).toEqual(["a.txt", "b.txt", "c.txt", "d.txt"]);
});

it("bounds row lookup to logarithmic work before returning a small interval", () => {
  let verticalReads = 0;
  const rows = Array.from({ length: 1024 }, (_, index) => ({
    path: `item-${index}`,
    get top() {
      verticalReads += 1;
      return index * 32;
    },
    get bottom() {
      verticalReads += 1;
      return index * 32 + 28;
    },
  }));

  expect(pathsInsideMarquee({ contentLeft: 0, contentRight: 400, rows }, 10, 16_010, 20, 16_020)).toEqual(["item-500"]);
  expect(verticalReads).toBeLessThan(50);
});
