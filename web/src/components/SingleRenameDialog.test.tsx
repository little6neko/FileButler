import { render, screen } from "@testing-library/react";
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
  render(<SingleRenameDialog rootId="root" path="old.txt" initialName="old.txt" onJobCreated={onJobCreated} onClose={vi.fn()} />);

  await userEvent.clear(screen.getByLabelText("New name"));
  await userEvent.type(screen.getByLabelText("New name"), "new.txt");
  await userEvent.click(screen.getByRole("button", { name: "Rename" }));

  expect(api.singleRenameCreateJob).toHaveBeenCalledWith({ rootId: "root", paths: ["old.txt"], newName: "new.txt" });
  expect(onJobCreated).toHaveBeenCalledWith("job_1");
});
