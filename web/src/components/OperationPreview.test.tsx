import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { OperationPreview } from "./OperationPreview";

vi.mock("../api/client", () => ({
  api: {
    opsDryRun: vi.fn(),
    opsCreateJob: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.opsDryRun).mockReset();
  vi.mocked(api.opsCreateJob).mockReset();
});

it("shows conflicts in operation preview and disables confirmation", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: true,
    items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: true, errorText: "exists" }],
  });
  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("exists")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
});

it("creates a job from a conflict-free operation plan", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: false }],
  });
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "job_1" });
  const onJobCreated = vi.fn();
  render(<OperationPreview request={request()} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm" })).not.toBeDisabled());
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(onJobCreated).toHaveBeenCalledWith("job_1");
});

function request() {
  return { type: "copy" as const, sourceRoot: "a", sources: ["a.txt"], destRoot: "b", destPath: "." };
}
