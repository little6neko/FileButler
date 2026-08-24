import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { textLanguageOptions } from "../textFiles";
import { TextEditorLanguageSelect } from "./TextEditorLanguageSelect";

describe("TextEditorLanguageSelect", () => {
  it("lists auto, plain text, and every highlighted language in display-name order", async () => {
    render(
      <TextEditorLanguageSelect
        selection="auto"
        automaticLanguage="go"
        requestedLanguage="go"
        loading={false}
        largeFileLocked={false}
        unavailable={false}
        labels={strings.en}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Syntax highlighting" });
    expect(trigger).toHaveTextContent("Auto (Go)");
    await userEvent.click(trigger);
    const optionLabels = screen.getAllByRole("option").map((option) => option.textContent);
    expect(optionLabels).toEqual([
      "Auto (Go)",
      ...textLanguageOptions().map(({ displayName }) => displayName),
    ]);
  });

  it("reports manual changes and exposes loading and large-file states", async () => {
    const onChange = vi.fn();
    const view = render(
      <TextEditorLanguageSelect
        selection="go"
        automaticLanguage="go"
        requestedLanguage="go"
        loading={false}
        largeFileLocked={false}
        unavailable={false}
        labels={strings.en}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Syntax highlighting" }));
    await userEvent.click(screen.getByRole("option", { name: "Python" }));
    expect(onChange).toHaveBeenCalledWith("python");

    view.rerender(
      <TextEditorLanguageSelect
        selection="python"
        automaticLanguage="go"
        requestedLanguage="python"
        loading
        largeFileLocked={false}
        unavailable={false}
        labels={strings.en}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toHaveTextContent("Loading Python…");
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toBeDisabled();

    view.rerender(
      <TextEditorLanguageSelect
        selection="python"
        automaticLanguage="go"
        requestedLanguage="plain"
        loading={false}
        largeFileLocked
        unavailable={false}
        labels={strings.en}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toHaveTextContent("Plain Text (large file)");
    expect(screen.getByRole("combobox", { name: "Syntax highlighting" })).toBeDisabled();
  });
});
