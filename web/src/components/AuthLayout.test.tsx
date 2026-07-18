import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { strings } from "../i18n";
import { AuthLayout } from "./AuthLayout";

it("renders FileButler branding around auth content", () => {
  render(
    <AuthLayout labels={strings["zh-CN"]}>
      <p>form</p>
    </AuthLayout>,
  );

  expect(screen.getByText("FileButler")).toBeInTheDocument();
  expect(screen.getByText("让文件整理更从容")).toBeInTheDocument();
  expect(screen.getByText("form")).toBeInTheDocument();
});
