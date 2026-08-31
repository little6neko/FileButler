import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { APIError, api } from "../api/client";
import type { LinkPreview as LinkPreviewData, LinkRequest } from "../api/types";
import { strings } from "../i18n";
import { LinkPreview, LinkPreviewContent } from "./LinkPreview";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      linkPreview: vi.fn(),
      linkCreateJob: vi.fn(),
    },
  };
});

beforeEach(() => {
  vi.mocked(api.linkPreview).mockReset();
  vi.mocked(api.linkCreateJob).mockReset();
});

it("renders reusable content and submits the authoritative revision", async () => {
  const activeRequest = request();
  vi.mocked(api.linkPreview).mockResolvedValue(preview(activeRequest));
  const onSubmit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  render(
    <LinkPreviewContent
      request={activeRequest}
      titleId="link-title"
      onSubmit={onSubmit}
      onClose={vi.fn()}
    />,
  );

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Hard link preview" })).toHaveAttribute("id", "link-title");
  expect(await screen.findByText("source:/album/a.jpg")).toBeInTheDocument();
  expect(screen.getByText("destination:/archive/a.jpg")).toBeInTheDocument();
  expect(screen.getByText("1 hard-linked file")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Create hard link" }));

  expect(onSubmit).toHaveBeenCalledWith({
    ...activeRequest,
    previewRevision: revision("a"),
  });
});

it("shows directory clone counts and localized source kinds", async () => {
  const activeRequest = request({ sources: ["album"] });
  vi.mocked(api.linkPreview).mockResolvedValue(preview(activeRequest, {
    progressTotal: 10,
    items: [{
      sourcePath: "album",
      destPath: "archive/album",
      sourceKind: "directory",
      counts: { directories: 3, files: 5, symlinks: 2 },
      conflict: false,
    }],
  }));
  render(<LinkPreview request={activeRequest} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("3 folders · 5 hard-linked files · 2 symbolic links")).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Folder" })).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Hard link preview" })).toHaveClass("sm:max-w-4xl");
});

it("localizes plan conflicts by error code and disables confirmation", async () => {
  const activeRequest = request();
  vi.mocked(api.linkPreview).mockResolvedValue(preview(activeRequest, {
    hasConflict: true,
    items: [{
      sourcePath: "album/a.jpg",
      destPath: "archive/a.jpg",
      sourceKind: "file",
      counts: { directories: 0, files: 1, symlinks: 0 },
      conflict: true,
      errorCode: "target_exists",
      errorText: "server fallback",
    }],
  }));
  render(<LinkPreview request={activeRequest} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByText("The destination already exists")).toBeInTheDocument();
  expect(screen.queryByText("server fallback")).not.toBeInTheDocument();
  expect(screen.getByText("1 conflict must be resolved before continuing.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create hard link" })).toBeDisabled();
});

it("keeps the dialog open and confirmation disabled after preview failure", async () => {
  vi.mocked(api.linkPreview).mockRejectedValue(new Error("preview unavailable"));
  render(<LinkPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByRole("alert")).toHaveTextContent("preview unavailable");
  expect(screen.getByRole("dialog", { name: "Hard link preview" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create hard link" })).toBeDisabled();
});

it("does not let an older target response replace the current preview", async () => {
  let resolveOld!: (value: LinkPreviewData) => void;
  const oldRequest = request();
  const nextRequest = request({ type: "symlink", destPath: "new-target" });
  vi.mocked(api.linkPreview)
    .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce(preview(nextRequest, { type: "symlink" }));
  const { rerender } = render(
    <LinkPreviewContent request={oldRequest} titleId="title" onSubmit={vi.fn()} onClose={vi.fn()} />,
  );

  rerender(<LinkPreviewContent request={nextRequest} titleId="title" onSubmit={vi.fn()} onClose={vi.fn()} />);
  expect(await screen.findByText("destination:/new-target/a.jpg")).toBeInTheDocument();
  resolveOld(preview(oldRequest));
  await waitFor(() => expect(screen.getByText("destination:/new-target/a.jpg")).toBeInTheDocument());
  expect(screen.queryByText("destination:/archive/a.jpg")).not.toBeInTheDocument();
});

it("creates one job and reports its ID", async () => {
  const activeRequest = request();
  vi.mocked(api.linkPreview).mockResolvedValue(preview(activeRequest));
  vi.mocked(api.linkCreateJob).mockResolvedValue({ id: "job-link" });
  const onJobCreated = vi.fn();
  render(<LinkPreview request={activeRequest} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  await userEvent.click(await enabledButton("Create hard link"));
  expect(api.linkCreateJob).toHaveBeenCalledWith({ ...activeRequest, previewRevision: revision("a") });
  expect(onJobCreated).toHaveBeenCalledWith("job-link");
});

it("prevents duplicate job submissions", async () => {
  const activeRequest = request();
  vi.mocked(api.linkPreview).mockResolvedValue(preview(activeRequest));
  let resolveJob!: (value: { id: string }) => void;
  vi.mocked(api.linkCreateJob).mockReturnValue(new Promise((resolve) => { resolveJob = resolve; }));
  render(<LinkPreview request={activeRequest} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  const button = await enabledButton("Create hard link");
  await userEvent.click(button);
  await userEvent.click(button);
  expect(api.linkCreateJob).toHaveBeenCalledTimes(1);
  resolveJob({ id: "job-link" });
});

it("shows localized creation errors and safe unknown details", async () => {
  const activeRequest = request();
  vi.mocked(api.linkPreview).mockResolvedValue(preview(activeRequest));
  vi.mocked(api.linkCreateJob).mockRejectedValue(new APIError("gateway_error", "proxy unavailable", 502));
  render(<LinkPreview request={activeRequest} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  await userEvent.click(await enabledButton("Create hard link"));
  expect(await screen.findByRole("alert")).toHaveTextContent("proxy unavailable");
  expect(screen.getByRole("button", { name: "Create hard link" })).toBeEnabled();
});

it("replaces stale data and requires a second explicit confirmation", async () => {
  const activeRequest = request();
  const latest = preview(activeRequest, { previewRevision: revision("c") });
  vi.mocked(api.linkPreview).mockResolvedValue(preview(activeRequest));
  vi.mocked(api.linkCreateJob)
    .mockRejectedValueOnce(new APIError("stale_preview", "changed", 409, latest))
    .mockResolvedValueOnce({ id: "job-latest" });
  const onJobCreated = vi.fn();
  render(<LinkPreview request={activeRequest} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  const button = await enabledButton("Create hard link");
  await userEvent.click(button);
  expect(await screen.findByText(strings.en.linkConfirmationRequired)).toBeInTheDocument();
  expect(api.linkCreateJob).toHaveBeenCalledTimes(1);
  expect(onJobCreated).not.toHaveBeenCalled();

  await userEvent.click(await enabledButton("Create hard link"));
  expect(api.linkCreateJob).toHaveBeenLastCalledWith({ ...activeRequest, previewRevision: revision("c") });
  expect(onJobCreated).toHaveBeenCalledWith("job-latest");
});

it("keeps refreshed conflicting data open and blocked", async () => {
  const activeRequest = request();
  const latest = preview(activeRequest, {
    previewRevision: revision("d"),
    hasConflict: true,
    items: [{
      sourcePath: "album/a.jpg",
      destPath: "archive/a.jpg",
      sourceKind: "file",
      counts: { directories: 0, files: 1, symlinks: 0 },
      conflict: true,
      errorCode: "target_exists",
    }],
  });
  vi.mocked(api.linkPreview).mockResolvedValue(preview(activeRequest));
  vi.mocked(api.linkCreateJob).mockRejectedValue(new APIError("plan_conflict", "conflict", 409, latest));
  render(<LinkPreview request={activeRequest} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  await userEvent.click(await enabledButton("Create hard link"));
  expect(await screen.findByText("The destination already exists")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create hard link" })).toBeDisabled();
  expect(api.linkCreateJob).toHaveBeenCalledTimes(1);
});

it("renders Chinese link labels and counts", async () => {
  const activeRequest = request({ type: "symlink" });
  vi.mocked(api.linkPreview).mockResolvedValue(preview(activeRequest, {
    type: "symlink",
    items: [{
      sourcePath: "album/a.jpg",
      destPath: "archive/a.jpg",
      sourceKind: "file",
      counts: { directories: 0, files: 0, symlinks: 1 },
      conflict: false,
    }],
  }));
  render(
    <LinkPreview
      request={activeRequest}
      labels={strings["zh-CN"]}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  expect(await screen.findByRole("heading", { name: "软链接预览" })).toBeInTheDocument();
  expect(screen.getByText("1 个符号链接")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "创建 1 个软链接" })).toBeEnabled();
});

async function enabledButton(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

function request(overrides: Partial<LinkRequest> = {}): LinkRequest {
  return {
    type: "hardlink",
    sourceRoot: "source",
    sources: ["album/a.jpg"],
    destRoot: "destination",
    destPath: "archive",
    ...overrides,
  };
}

function preview(activeRequest: LinkRequest, overrides: Partial<LinkPreviewData> = {}): LinkPreviewData {
  return {
    type: activeRequest.type,
    sourceRoot: activeRequest.sourceRoot,
    destRoot: activeRequest.destRoot,
    destPath: activeRequest.destPath,
    previewRevision: revision("a"),
    progressTotal: 1,
    hasConflict: false,
    items: activeRequest.sources.map((sourcePath) => ({
      sourcePath,
      destPath: `${activeRequest.destPath}/${sourcePath.split("/").at(-1)}`,
      sourceKind: "file" as const,
      counts: activeRequest.type === "hardlink"
        ? { directories: 0, files: 1, symlinks: 0 }
        : { directories: 0, files: 0, symlinks: 1 },
      conflict: false,
    })),
    ...overrides,
  };
}

function revision(character: string) {
  return `sha256:${character.repeat(64)}`;
}
