import type { Entry } from "./api/types";

const archiveSuffix = /\.(tar\.(gz|bz2|xz)|tgz|tbz2|txz|zip|7z|rar|tar)$/i;

export function isLocalArchive(entry: Entry | undefined): entry is Entry {
  return entry?.type === "file" && archiveSuffix.test(entry.name);
}

export function archiveDirectoryName(name: string): string {
  return name.replace(archiveSuffix, "");
}

export type ExtractRequest = {
  sourceRoot: string;
  sourcePath: string;
  destRoot: string;
  destPath: string;
  name: string;
  password: string;
};

export type ExtractTarget = Omit<ExtractRequest, "password">;
