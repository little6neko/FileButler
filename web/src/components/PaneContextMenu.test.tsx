import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Link2 } from "lucide-react";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { createFileActions, type FileContextAction } from "./fileActions";
import { PaneContextMenu } from "./PaneContextMenu";

it("renders every shared action and dispatches enabled items", async () => {
  const onMkdir = vi.fn();
  const onParentClick = vi.fn();
  const actions = createFileActions({
    destination: strings.en.rightPane,
    destinationDirection: "right",
    selectedCount: 1,
    labels: strings.en,
    commands: { onOperation: vi.fn(), onLink: vi.fn(), onMkdir, onRename: vi.fn(), onPowerRename: vi.fn(), onSuperRename: vi.fn() },
  });
  render(
    <div onClick={onParentClick}>
      <PaneContextMenu actions={actions} label={strings.en.fileActions}>
        <div data-testid="target">Target</div>
      </PaneContextMenu>
    </div>,
  );

  fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 80, clientY: 60 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  expect(within(menu).getAllByRole("menuitem")).toHaveLength(9);
  await userEvent.click(within(menu).getByRole("menuitem", { name: "mkdir" }));
  expect(onMkdir).toHaveBeenCalledOnce();
  expect(onParentClick).not.toHaveBeenCalled();
});

it("shows every empty-selection action while disabling all except mkdir", async () => {
  const actions = createFileActions({
    destination: strings.en.rightPane,
    destinationDirection: "right",
    selectedCount: 0,
    labels: strings.en,
    commands: { onOperation: vi.fn(), onLink: vi.fn(), onMkdir: vi.fn(), onRename: vi.fn(), onPowerRename: vi.fn(), onSuperRename: vi.fn() },
  });
  render(
    <PaneContextMenu actions={actions} label={strings.en.fileActions}>
      <div data-testid="target">Target</div>
    </PaneContextMenu>,
  );

  fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 80, clientY: 60 });
  const items = within(await screen.findByRole("menu", { name: "File actions" })).getAllByRole("menuitem");
  expect(items).toHaveLength(9);
  expect(items.find((item) => item.dataset.actionId === "mkdir")).not.toHaveAttribute("aria-disabled", "true");
  expect(items.filter((item) => item.dataset.actionId !== "mkdir" && item.dataset.actionId !== "superRename").every(
    (item) => item.getAttribute("aria-disabled") === "true",
  )).toBe(true);
  expect(items.find((item) => item.dataset.actionId === "superRename")).not.toHaveAttribute("aria-disabled", "true");
});

it("opens a submenu on hover and dispatches only its selected leaf", async () => {
  const user = userEvent.setup();
  const onHardlink = vi.fn();
  const onSymlink = vi.fn();
  render(
    <PaneContextMenu actions={linkSubmenu(onHardlink, onSymlink)} label="File actions">
      <div data-testid="target">Target</div>
    </PaneContextMenu>,
  );

  fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 80, clientY: 60 });
  const parent = await screen.findByRole("menu", { name: "File actions" });
  const trigger = within(parent).getByRole("menuitem", { name: "Create as" });
  await user.hover(trigger);
  const submenu = await screen.findByRole("menu", { name: "Create as" });
  fireEvent.click(within(submenu).getByRole("menuitem", { name: "Hard link" }));

  expect(onHardlink).toHaveBeenCalledOnce();
  expect(onSymlink).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu", { name: "File actions" })).not.toBeInTheDocument();
});

it("enters and leaves a submenu with arrow keys and closes one level per Escape", async () => {
  const user = userEvent.setup();
  const onHardlink = vi.fn();
  render(
    <PaneContextMenu actions={linkSubmenu(onHardlink, vi.fn())} label="File actions">
      <div data-testid="target">Target</div>
    </PaneContextMenu>,
  );

  fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 80, clientY: 60 });
  const parent = await screen.findByRole("menu", { name: "File actions" });
  const trigger = within(parent).getByRole("menuitem", { name: "Create as" });
  trigger.focus();
  await user.keyboard("{ArrowRight}");
  await screen.findByRole("menu", { name: "Create as" });

  await user.keyboard("{ArrowLeft}");
  await waitFor(() => expect(screen.queryByRole("menu", { name: "Create as" })).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();

  await user.keyboard("{ArrowRight}");
  await screen.findByRole("menu", { name: "Create as" });
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu", { name: "Create as" })).not.toBeInTheDocument());
  expect(screen.getByRole("menu", { name: "File actions" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu", { name: "File actions" })).not.toBeInTheDocument());
  expect(onHardlink).not.toHaveBeenCalled();
});

it("executes the highlighted submenu leaf with Enter", async () => {
  const user = userEvent.setup();
  const onHardlink = vi.fn();
  render(
    <PaneContextMenu actions={linkSubmenu(onHardlink, vi.fn())} label="File actions">
      <div data-testid="target">Target</div>
    </PaneContextMenu>,
  );

  fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 80, clientY: 60 });
  const trigger = within(await screen.findByRole("menu", { name: "File actions" }))
    .getByRole("menuitem", { name: "Create as" });
  trigger.focus();
  await user.keyboard("{ArrowRight}{Enter}");
  expect(onHardlink).toHaveBeenCalledOnce();
});

it("does not open a disabled submenu trigger", async () => {
  const user = userEvent.setup();
  const actions = linkSubmenu(vi.fn(), vi.fn());
  actions[0].disabled = true;
  render(
    <PaneContextMenu actions={actions} label="File actions">
      <div data-testid="target">Target</div>
    </PaneContextMenu>,
  );

  fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 80, clientY: 60 });
  const trigger = within(await screen.findByRole("menu", { name: "File actions" }))
    .getByRole("menuitem", { name: "Create as" });
  expect(trigger).toHaveAttribute("aria-disabled", "true");
  await user.hover(trigger);
  expect(screen.queryByRole("menu", { name: "Create as" })).not.toBeInTheDocument();
});

function linkSubmenu(onHardlink: () => void, onSymlink: () => void): FileContextAction[] {
  return [{
    kind: "submenu",
    id: "createLink",
    label: "Create as",
    icon: Link,
    disabled: false,
    items: [
      { kind: "command", id: "hardlink", label: "Hard link", icon: Link2, disabled: false, run: onHardlink },
      { kind: "command", id: "symlink", label: "Symbolic link", icon: Link, disabled: false, run: onSymlink },
    ],
  }];
}
