import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Entry } from "../api/types";
import type { FileDragSource, FileDropFeedback } from "../fileDrag";
import { strings } from "../i18n";
import { FileDragOverlay } from "./FileDragOverlay";

it("shows the first item, total count, inferred operation, and destination", () => {
  render(
    <FileDragOverlay
      source={source([entry("a.txt"), entry("b.txt")])}
      feedback={feedback("move", "folder")}
      labels={strings.en}
    />,
  );

  expect(screen.getByText("a.txt and 1 more")).toBeInTheDocument();
  expect(screen.getByText("move to folder")).toBeInTheDocument();
  expect(screen.getByLabelText("2 selected")).toHaveTextContent("2");
});

it("shows only the source summary before entering a target", () => {
  render(<FileDragOverlay source={source([entry("a.txt")])} feedback={null} labels={strings.en} />);
  expect(screen.getByText("a.txt")).toBeInTheDocument();
  expect(screen.queryByText(/ to /)).not.toBeInTheDocument();
});

function source(entries: Entry[]): FileDragSource {
  return { pane: "left", rootId: "root", parentPath: ".", entries };
}

function feedback(operation: "move" | "copy", label: string): FileDropFeedback {
  return {
    operation,
    valid: true,
    target: { id: "target", kind: "directory", pane: "right", rootId: "root", path: label, label },
  };
}

function entry(name: string): Entry {
  return { name, relativePath: name, type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false };
}
