export type Root = { id: string; name: string };

export type Entry = {
  name: string;
  relativePath: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  mode: string;
  modifiedUnix: number;
  isSymlink: boolean;
  symlinkTarget?: string;
};

export type RenameOptions = {
  search: string;
  replace: string;
  useRegex: boolean;
  caseSensitive: boolean;
  matchAll: boolean;
  target: "name" | "extension" | "both";
  includeFiles: boolean;
  includeDirs: boolean;
  includeSubfolders: boolean;
  enumerate: boolean;
};

export type OpsRequest = {
  type: "move" | "copy" | "symlink" | "hardlink" | "delete" | "mkdir";
  sourceRoot: string;
  sources: string[];
  destRoot?: string;
  destPath?: string;
  newName?: string;
};

export type RenameRequest = {
  rootId: string;
  paths: string[];
  options: RenameOptions;
};

export type PlanItem = {
  operation?: string;
  sourcePath: string;
  destPath?: string;
  targetPath?: string;
  oldName?: string;
  newName?: string;
  changed?: boolean;
  conflict: boolean;
  errorCode?: string;
  errorText?: string;
};

export type Job = {
  id: string;
  type: string;
  status: string;
  progressTotal: number;
  progressDone: number;
  errorMessage: string;
};
