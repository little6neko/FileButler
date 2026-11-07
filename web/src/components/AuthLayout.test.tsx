import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AuthLayout } from "./AuthLayout";

it("renders only the shared auth card with its language control", () => {
  render(
    <AuthLayout title="管理员登录" description="登录以进入 FileButler。" languageControl={<button>Language</button>}>
      <p>form</p>
    </AuthLayout>,
  );

  expect(screen.getByRole("heading", { name: "管理员登录" })).toBeInTheDocument();
  expect(screen.queryByText("让文件整理更从容")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Language" }).closest('[data-slot="card-header"]')).not.toBeNull();
  expect(screen.getByText("form")).toBeInTheDocument();
});
