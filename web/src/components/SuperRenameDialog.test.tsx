import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { strings } from "../i18n";
import { SuperRenameDialog } from "./SuperRenameDialog";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SuperRenameDialog", () => {
  it("uses a large compact-mode dialog around the shared content", async () => {
    vi.spyOn(api, "superRenamePreview").mockResolvedValue({
      rootId: "media",
      directoryPath: "albums",
      generatedAtUnix: 1,
      groups: [],
    });
    render(
      <SuperRenameDialog
        rootId="media"
        directoryPath="albums"
        labels={strings.en}
        onClose={vi.fn()}
        onJobCreated={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-[min(1400px,96vw)]");
    expect(await screen.findByText("No matching media")).toBeInTheDocument();
    expect(api.superRenamePreview).toHaveBeenCalledWith({ rootId: "media", directoryPath: "albums" });
  });
});
