import { afterEach, expect, it, vi } from "vitest";
import { copyText } from "./copyText";

afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(document, "execCommand"); });

it("copies on plain HTTP when the Clipboard API is absent, then restores focus", async () => {
  vi.stubGlobal("navigator", {});
  const button = document.createElement("button");
  document.body.append(button); button.focus();
  const execute = vi.fn(() => {
    expect(document.querySelector("textarea")?.value).toBe("https://cdn.example/file");
    return true;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: execute });
  try {
    await copyText("https://cdn.example/file");
    expect(execute).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
  } finally { button.remove(); }
});

it("does not report success when legacy clipboard access is also denied", async () => {
  vi.stubGlobal("navigator", {});
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
  await expect(copyText("https://cdn.example/file")).rejects.toThrow("Clipboard copy failed");
  expect(document.querySelector("textarea")).toBeNull();
});
