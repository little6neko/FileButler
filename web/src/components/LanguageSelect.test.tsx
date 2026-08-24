import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { LanguageSelect } from "./LanguageSelect";

it("renders the translated label for the selected language mode", () => {
  render(<LanguageSelect value="auto" onChange={vi.fn()} labels={strings.en} />);

  const trigger = screen.getByRole("combobox", { name: "Language" });
  expect(trigger).toHaveTextContent("Auto");
  expect(trigger).toHaveClass("w-36");
  expect(trigger).not.toHaveClass("w-[118px]");
});

it("opens an animated taskbar menu above system panels and changes language", async () => {
  const onChange = vi.fn();
  render(<LanguageSelect value="auto" onChange={onChange} labels={strings.en} />);

  await userEvent.click(screen.getByRole("combobox", { name: "Language" }));
  const english = await screen.findByRole("option", { name: "English" });
  const positioner = document.querySelector('[data-slot="select-positioner"]');
  const content = document.querySelector('[data-slot="select-content"]');
  expect(positioner).toHaveClass("taskbar-language-menu-positioner");
  expect(content).toHaveAttribute("data-align-trigger", "false");
  expect(content).toHaveClass("data-open:fade-in-0", "data-closed:fade-out-0");

  await userEvent.click(english);
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith("en");
});
