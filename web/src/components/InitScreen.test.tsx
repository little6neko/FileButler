import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { InitScreen } from "./InitScreen";

vi.mock("../api/client", () => ({
  api: {
    createAdmin: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.createAdmin).mockReset();
});

it("submits custom admin username and password from InitScreen", async () => {
  vi.mocked(api.createAdmin).mockResolvedValue({ id: 1, username: "root" });
  const onInitialized = vi.fn();
  render(<InitScreen onInitialized={onInitialized} />);

  await userEvent.type(screen.getByLabelText("Username"), "root");
  await userEvent.type(screen.getByLabelText("Password"), "long-password");
  await userEvent.type(screen.getByLabelText("Confirm password"), "long-password");
  await userEvent.click(screen.getByRole("button", { name: "Create administrator" }));

  expect(api.createAdmin).toHaveBeenCalledWith("root", "long-password");
  expect(onInitialized).toHaveBeenCalled();
});

it("shows validation message for short password in InitScreen", async () => {
  render(<InitScreen onInitialized={vi.fn()} />);
  await userEvent.type(screen.getByLabelText("Username"), "root");
  await userEvent.type(screen.getByLabelText("Password"), "short");
  await userEvent.type(screen.getByLabelText("Confirm password"), "short");
  await userEvent.click(screen.getByRole("button", { name: "Create administrator" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Password must be at least 10 characters");
  expect(api.createAdmin).not.toHaveBeenCalled();
});
