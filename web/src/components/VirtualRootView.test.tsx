import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { VirtualRootView } from "./VirtualRootView";

const root = { id: "data", name: "Data" };

it("opens a mapped root only after a pointer double-click", async () => {
  const user = userEvent.setup();
  const onOpenRoot = vi.fn();
  renderView(onOpenRoot);
  const card = screen.getByRole("button", { name: /Data/ });

  await user.click(card);

  expect(card).toHaveFocus();
  expect(onOpenRoot).not.toHaveBeenCalled();

  await user.dblClick(card);

  expect(onOpenRoot).toHaveBeenCalledTimes(1);
  expect(onOpenRoot).toHaveBeenCalledWith(root);
});

it.each([
  { keyName: "Enter", keys: "{Enter}" },
  { keyName: "Space", keys: " " },
])("opens a mapped root with $keyName", async ({ keys }) => {
  const user = userEvent.setup();
  const onOpenRoot = vi.fn();
  renderView(onOpenRoot);
  const card = screen.getByRole("button", { name: /Data/ });
  card.focus();

  await user.keyboard(keys);

  expect(onOpenRoot).toHaveBeenCalledTimes(1);
  expect(onOpenRoot).toHaveBeenCalledWith(root);
});

it("keeps mapped-root drop feedback on the card", () => {
  render(
    <VirtualRootView
      roots={[root]}
      surfaceId="window-1"
      dropFeedback={{
        target: {
          id: "drop:window-1:root:data",
          kind: "current-directory",
          pane: "window-1",
          rootId: "data",
          path: ".",
          label: "Data",
        },
        operation: "copy",
        valid: true,
      }}
      labels={strings.en}
      onActivate={vi.fn()}
      onOpenRoot={vi.fn()}
      actionsForRoot={() => []}
    />,
  );

  expect(screen.getByRole("button", { name: /Data/ })).toHaveAttribute("data-drop-state", "valid");
});

it("marks root-card drops disabled while a local dialog covers the window", () => {
  const { container } = render(
    <VirtualRootView
      roots={[root]}
      surfaceId="session-1"
      dropWindowId="window-1"
      dropDisabled
      dropFeedback={null}
      labels={strings.en}
      onActivate={vi.fn()}
      onOpenRoot={vi.fn()}
      actionsForRoot={() => []}
    />,
  );

  expect(container.querySelector(".virtual-root")).toHaveAttribute("data-drop-disabled", "true");
  expect(container.querySelector(".virtual-root")).toHaveAttribute("data-drop-window-id", "window-1");
  expect(screen.getByRole("button", { name: /Data/ })).toHaveAttribute("data-drop-disabled", "true");
  expect(screen.getByRole("button", { name: /Data/ })).toHaveAttribute("data-drop-window-id", "window-1");
});

function renderView(onOpenRoot: (selectedRoot: typeof root) => void) {
  render(
    <VirtualRootView
      roots={[root]}
      surfaceId="window-1"
      dropFeedback={null}
      labels={strings.en}
      onActivate={vi.fn()}
      onOpenRoot={onOpenRoot}
      actionsForRoot={() => []}
    />,
  );
}
