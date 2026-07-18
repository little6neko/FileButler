import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { strings } from "../i18n";
import { LoginScreen } from "./LoginScreen";

vi.mock("../api/client", () => ({
  api: {
    login: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.login).mockReset();
});

it("submits login credentials from LoginScreen", async () => {
  vi.mocked(api.login).mockResolvedValue({ id: 1, username: "admin" });
  const onLoggedIn = vi.fn();
  render(<LoginScreen onLoggedIn={onLoggedIn} />);

  await userEvent.type(screen.getByLabelText("Username"), "admin");
  await userEvent.type(screen.getByLabelText("Password"), "long-password");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));

  expect(api.login).toHaveBeenCalledWith("admin", "long-password");
  expect(onLoggedIn).toHaveBeenCalled();
});

it("shows API errors in LoginScreen", async () => {
  vi.mocked(api.login).mockRejectedValue(new Error("invalid username or password"));
  render(<LoginScreen onLoggedIn={vi.fn()} />);

  await userEvent.type(screen.getByLabelText("Username"), "admin");
  await userEvent.type(screen.getByLabelText("Password"), "bad-password");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));

  expect(screen.getByRole("alert")).toHaveTextContent("invalid username or password");
});

it("renders the login form in Chinese", () => {
  render(<LoginScreen labels={strings["zh-CN"]} onLoggedIn={vi.fn()} />);

  expect(screen.getByRole("heading", { name: "管理员登录" })).toBeInTheDocument();
  expect(screen.getByLabelText("用户名")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
});
