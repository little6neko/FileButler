import { describe, expect, it, vi } from "vitest";
import { createCodeMirrorLoader } from "./codeMirrorLoader";
import { textFileDescriptor } from "./textFiles";

describe("CodeMirror loader", () => {
  it("loads every core module once and reuses the same promise", async () => {
    const dependencies = {
      loadState: vi.fn(async () => ({ name: "state" }) as never),
      loadView: vi.fn(async () => ({ name: "view" }) as never),
      loadCommands: vi.fn(async () => ({ name: "commands" }) as never),
      loadSearch: vi.fn(async () => ({ name: "search" }) as never),
      loadLanguage: vi.fn(async () => ({ name: "language" }) as never),
    };
    const loader = createCodeMirrorLoader(dependencies);

    const first = loader.loadCore();
    const second = loader.loadCore();
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ state: { name: "state" }, view: { name: "view" } });
    for (const load of Object.values(dependencies)) expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads a language once and reuses the in-flight result", async () => {
    const extension = { language: "go" };
    const load = vi.fn(async () => extension as never);
    const loadLanguageData = vi.fn(async () => [
      { name: "Go", alias: ["go"], extensions: ["go"], load },
    ] as never);
    const loader = createCodeMirrorLoader({ loadLanguageData });
    const descriptor = textFileDescriptor("main.go")!;

    const first = loader.loadLanguage(descriptor, "main.go");
    const second = loader.loadLanguage(descriptor, "another.go");
    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ extension, degraded: false });
    expect(loadLanguageData).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not import language data for plain text", async () => {
    const loadLanguageData = vi.fn(async () => [] as never);
    const loader = createCodeMirrorLoader({ loadLanguageData });

    await expect(loader.loadLanguage(textFileDescriptor("notes.txt")!, "notes.txt")).resolves.toEqual({
      extension: null,
      degraded: false,
    });
    expect(loadLanguageData).not.toHaveBeenCalled();
  });

  it("turns missing and failed languages into a plaintext degradation", async () => {
    const failedLoad = vi.fn(async () => { throw new Error("chunk unavailable"); });
    const failed = createCodeMirrorLoader({
      loadLanguageData: vi.fn(async () => [
        { name: "Go", alias: ["go"], extensions: ["go"], load: failedLoad },
      ] as never),
    });
    await expect(failed.loadLanguage(textFileDescriptor("main.go")!, "main.go")).resolves.toEqual({
      extension: null,
      degraded: true,
    });

    const missing = createCodeMirrorLoader({ loadLanguageData: vi.fn(async () => [] as never) });
    await expect(missing.loadLanguage(textFileDescriptor("main.rs")!, "main.rs")).resolves.toEqual({
      extension: null,
      degraded: true,
    });
  });

  it("selects explicit language-data names for ambiguous extensions and special files", async () => {
    const loadedNames: string[] = [];
    const descriptions = ["Properties files", "Objective-C++", "Dockerfile", "VB.NET"].map((name) => ({
      name,
      alias: [name.toLowerCase()],
      extensions: [],
      load: async () => {
        loadedNames.push(name);
        return { name } as never;
      },
    }));
    const loader = createCodeMirrorLoader({ loadLanguageData: async () => descriptions as never });

    await loader.loadLanguage(textFileDescriptor("settings.cfg")!, "settings.cfg");
    await loader.loadLanguage(textFileDescriptor("main.mm")!, "main.mm");
    await loader.loadLanguage(textFileDescriptor("Dockerfile.dev")!, "Dockerfile.dev");
    await loader.loadLanguage(textFileDescriptor("Module.vb")!, "Module.vb");
    expect(loadedNames).toEqual(["Properties files", "Objective-C++", "Dockerfile", "VB.NET"]);
  });
});
