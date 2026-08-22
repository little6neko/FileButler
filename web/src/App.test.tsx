import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "./api/client";
import App from "./App";
import html from "../index.html?raw";

vi.mock("./api/client", () => ({
  api: {
    initStatus: vi.fn(),
    me: vi.fn(),
    roots: vi.fn(),
    browse: vi.fn(),
    cancelJob: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.initStatus).mockResolvedValue({ needsInitialization: false });
  vi.mocked(api.me).mockResolvedValue({ id: 1, username: "admin" });
  vi.mocked(api.roots).mockResolvedValue([{ id: "downloads", name: "Downloads" }]);
  vi.mocked(api.browse).mockResolvedValue([]);
});

it("renders the FileButler app shell", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: "FileButler" })).toBeInTheDocument();
});

it("sets the browser page title to FileButler", () => {
  expect(html).toContain("<title>FileButler</title>");
});

it("allows manually switching to Simplified Chinese labels", async () => {
  render(<App />);

  await screen.findByRole("button", { name: "Open File Manager" });
  await userEvent.click(await screen.findByRole("combobox", { name: "Language" }));
  await userEvent.click(await screen.findByRole("option", { name: "简体中文" }));

  expect(screen.getByRole("button", { name: "切换到精简模式" })).toBeInTheDocument();
});

it("uses the selected language on the login screen", async () => {
  vi.mocked(api.me).mockRejectedValue(new Error("unauthorized"));
  render(<App />);

  await userEvent.click(await screen.findByRole("combobox", { name: "Language" }));
  await userEvent.click(await screen.findByRole("option", { name: "简体中文" }));
  expect(screen.getByRole("heading", { name: "管理员登录" })).toBeInTheDocument();
});
