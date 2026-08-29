import { describe, expect, it } from "vitest";
import {
  browserHistoryTarget,
  createBrowserHistory,
  moveBrowserHistory,
  parentDirectoryLocation,
  recordBrowserVisit,
  type DirectoryLocation,
} from "./browserHistory";

describe("browser directory history", () => {
  it("moves backward and forward through directory visits", () => {
    const root = location("source", ".");
    const photos = location("source", "photos");
    const raw = location("source", "photos/raw");
    let history = createBrowserHistory();

    history = recordBrowserVisit(history, root, photos);
    history = recordBrowserVisit(history, photos, raw);
    expect(browserHistoryTarget(history, "back")).toEqual(photos);
    expect(browserHistoryTarget(history, "forward")).toBeNull();

    const firstBack = moveBrowserHistory(history, raw, "back");
    expect(firstBack?.target).toEqual(photos);
    expect(browserHistoryTarget(firstBack!.history, "back")).toEqual(root);
    expect(browserHistoryTarget(firstBack!.history, "forward")).toEqual(raw);

    const secondBack = moveBrowserHistory(firstBack!.history, photos, "back");
    const forward = moveBrowserHistory(secondBack!.history, root, "forward");
    expect(forward?.target).toEqual(photos);
    expect(browserHistoryTarget(forward!.history, "forward")).toEqual(raw);
  });

  it("clears forward history after visiting a new directory", () => {
    const root = location("source", ".");
    const photos = location("source", "photos");
    const raw = location("source", "photos/raw");
    const videos = location("source", "videos");
    let history = recordBrowserVisit(createBrowserHistory(), root, photos);
    history = recordBrowserVisit(history, photos, raw);
    const back = moveBrowserHistory(history, raw, "back")!;

    const branched = recordBrowserVisit(back.history, back.target, videos);

    expect(browserHistoryTarget(branched, "forward")).toBeNull();
    expect(browserHistoryTarget(branched, "back")).toEqual(photos);
  });

  it("does not duplicate a visit to the current directory", () => {
    const root = location("source", ".");

    expect(recordBrowserVisit(createBrowserHistory(), root, root)).toEqual(createBrowserHistory());
  });
});

describe("parent directory navigation", () => {
  it("returns each parent until the mapped root", () => {
    expect(parentDirectoryLocation(location("source", "photos/raw"))).toEqual(location("source", "photos"));
    expect(parentDirectoryLocation(location("source", "photos"))).toEqual(location("source", "."));
    expect(parentDirectoryLocation(location("source", "."))).toBeNull();
  });
});

function location(rootId: string, path: string): DirectoryLocation {
  return { kind: "directory", rootId, path };
}
