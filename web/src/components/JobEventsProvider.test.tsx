import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { JobEventsProvider } from "./JobEventsProvider";

it("owns and closes a single event stream", () => {
  const source = {
    onopen: null,
    onerror: null,
    addEventListener: vi.fn(),
    close: vi.fn(),
  };
  const factory = vi.fn(() => source);
  const view = render(<JobEventsProvider eventSourceFactory={factory}><div>workspace</div></JobEventsProvider>);

  expect(factory).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(source.close).toHaveBeenCalledTimes(1);
});
