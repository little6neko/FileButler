import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { SingleRenameDialog } from "./SingleRenameDialog";

vi.mock("../api/client", () => ({
  api: {
    singleRenameCreateJob: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.singleRenameCreateJob).mockReset();
});

it("creates a single rename job with the new basename", async () => {
  vi.mocked(api.singleRenameCreateJob).mockResolvedValue({ id: "job_1" });
  const onJobCreated = vi.fn();
  render(<SingleRenameDialog rootId="root" path="old.txt" initialName="old.txt" entryType="file" onJobCreated={onJobCreated} onClose={vi.fn()} />);

  expect(screen.getByRole("dialog", { name: "Rename dialog" })).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("New name"));
  await userEvent.type(screen.getByLabelText("New name"), "new.txt");
  await userEvent.keyboard("{Enter}");

  expect(api.singleRenameCreateJob).toHaveBeenCalledWith({ rootId: "root", paths: ["old.txt"], newName: "new.txt" });
  expect(onJobCreated).toHaveBeenCalledWith("job_1");
});

it("ignores Enter when the new name is empty", async () => {
  render(<SingleRenameDialog rootId="root" path="old.txt" initialName="old.txt" entryType="file" onJobCreated={vi.fn()} onClose={vi.fn()} />);

  await userEvent.clear(screen.getByLabelText("New name"));
  await userEvent.keyboard("{Enter}");

  expect(api.singleRenameCreateJob).not.toHaveBeenCalled();
});

it.each([
  ["photo.jpg", "file", 5],
  ["archive.tar.gz", "file", 11],
  ["README", "file", 6],
  [".env", "file", 4],
  [".env.local", "file", 4],
  ["name.", "file", 5],
  ["photos.2026", "directory", 11],
] as const)("selects the editable part of %s", (initialName, entryType, selectionEnd) => {
  render(
    <SingleRenameDialog
      rootId="root"
      path={initialName}
      initialName={initialName}
      entryType={entryType}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  const input = screen.getByLabelText("New name") as HTMLInputElement;
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(selectionEnd);
});

it("does not restore the initial selection when the input is focused again", () => {
  render(
    <SingleRenameDialog
      rootId="root"
      path="photo.jpg"
      initialName="photo.jpg"
      entryType="file"
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  const input = screen.getByLabelText("New name") as HTMLInputElement;
  input.setSelectionRange(2, 2);
  fireEvent.blur(input);
  fireEvent.focus(input);

  expect(input.selectionStart).toBe(2);
  expect(input.selectionEnd).toBe(2);
});
