import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { DualPane } from "./DualPane";

vi.mock("../api/client", () => ({
  api: {
    roots: vi.fn(),
    browse: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.roots).mockReset();
  vi.mocked(api.browse).mockReset();
});

it("loads roots and renders two panes", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "data", name: "Data" }]);
  vi.mocked(api.browse).mockResolvedValue([]);
  render(<DualPane />);

  expect(await screen.findByRole("region", { name: "Left pane" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Right pane" })).toBeInTheDocument();
});

it("loads entries when a root is selected", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "data", name: "Data" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "file.txt", relativePath: "file.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  render(<DualPane />);

  await waitFor(() => expect(api.browse).toHaveBeenCalledWith("data", "."));
  expect(await screen.findAllByText("file.txt")).toHaveLength(2);
});
