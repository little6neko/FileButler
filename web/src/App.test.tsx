import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "./api/client";
import App from "./App";

vi.mock("./api/client", () => ({
  api: {
    initStatus: vi.fn(),
    me: vi.fn(),
    roots: vi.fn(),
    browse: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.initStatus).mockResolvedValue({ needsInitialization: false });
  vi.mocked(api.me).mockResolvedValue({ id: 1, username: "admin" });
  vi.mocked(api.roots).mockResolvedValue([{ id: "downloads", name: "Downloads" }]);
  vi.mocked(api.browse).mockResolvedValue([]);
});

it("renders the FileButler app shell", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "FileButler" })).toBeInTheDocument();
});

it("allows manually switching to Simplified Chinese labels", async () => {
  render(<App />);

  await userEvent.selectOptions(screen.getByLabelText("Language"), "zh-CN");

  expect(screen.getByRole("button", { name: "移动" })).toBeInTheDocument();
});
