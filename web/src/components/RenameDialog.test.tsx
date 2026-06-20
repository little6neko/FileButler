import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { RenameDialog } from "./RenameDialog";

vi.mock("../api/client", () => ({
  api: {
    renamePreview: vi.fn(),
    renameCreateJob: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.renamePreview).mockReset();
  vi.mocked(api.renameCreateJob).mockReset();
});

it("requests preview when rename options change", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  await userEvent.type(screen.getByLabelText("Search"), "file");
  await waitFor(() => expect(api.renamePreview).toHaveBeenCalled());
});

it("shows original and renamed values", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "file.txt", oldName: "file.txt", newName: "photo.txt", conflict: false }],
  });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("photo.txt")).toBeInTheDocument();
});

it("disables run button when preview has conflicts", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: true,
    items: [{ sourcePath: "file.txt", oldName: "file.txt", newName: "photo.txt", conflict: true, errorText: "exists" }],
  });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("exists")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Run rename" })).toBeDisabled();
});

it("creates a rename job from selected files", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  vi.mocked(api.renameCreateJob).mockResolvedValue({ id: "job_1" });
  const onJobCreated = vi.fn();
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Run rename" }));
  expect(onJobCreated).toHaveBeenCalledWith("job_1");
});

it("keeps enumerate option visible with a checkbox", () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByLabelText("Enumerate")).toBeInTheDocument();
});
