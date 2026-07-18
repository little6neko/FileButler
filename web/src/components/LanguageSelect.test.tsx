import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { LanguageSelect } from "./LanguageSelect";

it("renders the translated label for the selected language mode", () => {
  render(<LanguageSelect value="auto" onChange={vi.fn()} labels={strings.en} />);

  expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("Auto");
});
