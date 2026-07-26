import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { createFileActions } from "./fileActions";
import { PaneContextMenu } from "./PaneContextMenu";

it("renders every shared action and dispatches enabled items", async () => {
  const onMkdir = vi.fn();
  const actions = createFileActions({
    destination: strings.en.rightPane,
    selectedCount: 1,
    labels: strings.en,
    commands: { onOperation: vi.fn(), onMkdir, onRename: vi.fn(), onPowerRename: vi.fn() },
  });
  render(
    <PaneContextMenu actions={actions} label={strings.en.fileActions}>
      <div data-testid="target">Target</div>
    </PaneContextMenu>,
  );

  fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 80, clientY: 60 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  expect(within(menu).getAllByRole("menuitem")).toHaveLength(8);
  await userEvent.click(within(menu).getByRole("menuitem", { name: "mkdir" }));
  expect(onMkdir).toHaveBeenCalledOnce();
});

it("shows every empty-selection action while disabling all except mkdir", async () => {
  const actions = createFileActions({
    destination: strings.en.rightPane,
    selectedCount: 0,
    labels: strings.en,
    commands: { onOperation: vi.fn(), onMkdir: vi.fn(), onRename: vi.fn(), onPowerRename: vi.fn() },
  });
  render(
    <PaneContextMenu actions={actions} label={strings.en.fileActions}>
      <div data-testid="target">Target</div>
    </PaneContextMenu>,
  );

  fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 80, clientY: 60 });
  const items = within(await screen.findByRole("menu", { name: "File actions" })).getAllByRole("menuitem");
  expect(items).toHaveLength(8);
  expect(items.find((item) => item.dataset.actionId === "mkdir")).not.toHaveAttribute("aria-disabled", "true");
  expect(items.filter((item) => item.dataset.actionId !== "mkdir").every(
    (item) => item.getAttribute("aria-disabled") === "true",
  )).toBe(true);
});
