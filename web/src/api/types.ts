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
  nameOnly: boolean;
  extensionOnly: boolean;
  fullName: boolean;
  excludeFiles: boolean;
  excludeFolders: boolean;
  excludeSubfolders: boolean;
  uppercase: boolean;
  lowercase: boolean;
  titlecase: boolean;
  capitalized: boolean;
  enumerateItems: boolean;
  randomizeItems: boolean;
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

export type SingleRenameRequest = {
  rootId: string;
  paths: string[];
  newName: string;
};

export type PlanItem = {
  operation?: string;
  sourceRoot?: string;
  sourcePath: string;
  destRoot?: string;
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
  actorId: number;
  sourceRootId: string;
  destRootId?: string;
  progressTotal: number;
  progressDone: number;
  failedCount: number;
  cancelRequested: boolean;
  errorMessage: string;
  createdAtUnix: number;
  updatedAtUnix: number;
  finishedAtUnix?: number;
  eventVersion: number;
};

export type JobEvent = {
  runtimeId: string;
  cursor: number;
  job: Job;
};

export type JobSnapshot = {
  runtimeId: string;
  cursor: number;
  reset: boolean;
  jobs: Job[];
};
