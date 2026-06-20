import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
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
