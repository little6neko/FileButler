import type { TextDocument } from "./api/types";

export const cloudTextLimit = 10 * 1024 * 1024;
export type CloudPreviewLink = { url: string; name: string; size: number; accountId: string };

export async function readCloudText(url: string, signal: AbortSignal): Promise<TextDocument> {
  const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("无法直接读取115文本，请重试或直接下载。");
  if (Number(response.headers.get("Content-Length")) > cloudTextLimit) {
    await response.body.cancel();
    throw new Error("文本超过10 MiB预览上限，请直接下载。");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cloudTextLimit) throw new Error("文本超过10 MiB预览上限，请直接下载。");
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let encoding: TextDocument["encoding"] = "utf-8";
  let content: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le-bom"; content = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be-bom"; content = new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  } else {
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { encoding = "gb18030"; content = new TextDecoder("gb18030", { fatal: true }).decode(bytes); }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = "utf-8-bom";
  }
  if (content.includes("\0")) throw new Error("文件含二进制内容，无法作为文本预览");
  const endings = new Set((content.match(/\r\n|\r|\n/g) ?? []).map((value) => value === "\r\n" ? "crlf" as const : value === "\r" ? "cr" as const : "lf" as const));
  return { content, byteSize: size, encoding, revision: "cloud-read-only", lineEnding: endings.size > 1 ? "mixed" : [...endings][0] ?? "none", preferredLineEnding: [...endings][0] ?? "lf" };
}
