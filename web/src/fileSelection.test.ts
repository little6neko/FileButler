import { describe, expect, it } from "vitest";
import { applyFileSelection } from "./fileSelection";

describe("applyFileSelection", () => {
  it("replaces selection and updates the anchor for a plain click", () => {
    const selected = new Set(["a.txt", "b.txt"]);

    const result = applyFileSelection(selected, "a.txt", ["a.txt", "b.txt", "c.txt"], "c.txt", "single");

    expect([...result.selected]).toEqual(["c.txt"]);
    expect(result.anchor).toBe("c.txt");
    expect([...selected]).toEqual(["a.txt", "b.txt"]);
  });

  it("toggles only the target and makes it the anchor", () => {
    const added = applyFileSelection(new Set(["a.txt"]), "a.txt", ["a.txt", "b.txt"], "b.txt", "toggle");
    expect([...added.selected]).toEqual(["a.txt", "b.txt"]);
    expect(added.anchor).toBe("b.txt");

    const removed = applyFileSelection(added.selected, added.anchor, ["a.txt", "b.txt"], "b.txt", "toggle");
    expect([...removed.selected]).toEqual(["a.txt"]);
    expect(removed.anchor).toBe("b.txt");
  });

  it("uses a first range click as a single selection when no valid anchor exists", () => {
    const missing = applyFileSelection(new Set(["a.txt"]), null, ["a.txt", "b.txt", "c.txt"], "b.txt", "range");
    expect([...missing.selected]).toEqual(["b.txt"]);
    expect(missing.anchor).toBe("b.txt");

    const hidden = applyFileSelection(new Set(["hidden.txt"]), "hidden.txt", ["a.txt", "b.txt", "c.txt"], "c.txt", "range");
    expect([...hidden.selected]).toEqual(["c.txt"]);
    expect(hidden.anchor).toBe("c.txt");
  });

  it("selects inclusive ranges in either direction while preserving the original anchor", () => {
    const order = ["a.txt", "b.txt", "c.txt", "d.txt"];
    const forward = applyFileSelection(new Set(["b.txt"]), "b.txt", order, "d.txt", "range");
    expect([...forward.selected]).toEqual(["b.txt", "c.txt", "d.txt"]);
    expect(forward.anchor).toBe("b.txt");

    const reverse = applyFileSelection(forward.selected, forward.anchor, order, "a.txt", "range");
    expect([...reverse.selected]).toEqual(["a.txt", "b.txt"]);
    expect(reverse.anchor).toBe("b.txt");
  });

  it("follows the supplied visible sorted order", () => {
    const order = ["folder-z", "folder-a", "z.txt", "m.txt", "a.txt"];

    const result = applyFileSelection(new Set(["z.txt"]), "z.txt", order, "a.txt", "range");

    expect([...result.selected]).toEqual(["z.txt", "m.txt", "a.txt"]);
    expect(result.anchor).toBe("z.txt");
  });
});
