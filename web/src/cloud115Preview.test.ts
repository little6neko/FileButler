import { afterEach, expect, it, vi } from "vitest";
import { cloudTextLimit, readCloudText } from "./cloud115Preview";

afterEach(() => vi.unstubAllGlobals());
it("reads text directly with no cookies and preserves encoding metadata", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("hello\r\nworld"));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  const result = await readCloudText("https://cdn.example/notes.txt", signal);
  expect(result).toMatchObject({ content: "hello\r\nworld", encoding: "utf-8", lineEnding: "crlf" });
  expect(fetcher).toHaveBeenCalledWith("https://cdn.example/notes.txt", { signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
});

it("rejects oversized and binary responses without proxy fallback", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("small", { headers: { "Content-Length": String(cloudTextLimit + 1) } })).mockResolvedValueOnce(new Response("binary\0data"));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  await expect(readCloudText("https://cdn.example/a.txt", signal)).rejects.toThrow("10 MiB");
  await expect(readCloudText("https://cdn.example/a.txt", signal)).rejects.toThrow("二进制");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("enforces the stream size limit when Content-Length is absent", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array(cloudTextLimit + 1)));
  vi.stubGlobal("fetch", fetcher);
  await expect(readCloudText("https://cdn.example/a.txt", new AbortController().signal)).rejects.toThrow("10 MiB");
});
