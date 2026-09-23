export type Root = { id: string; name: string };

export type SymlinkResolution = {
  state: "mapped" | "unmapped" | "broken";
  targetKind?: "file" | "directory" | "symlink" | "other";
  targetRootId?: string;
  targetPath?: string;
};

export type Entry = {
  navigationPath?: string;
  name: string;
  relativePath: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  mode: string;
  modifiedUnix: number;
  isSymlink: boolean;
  symlinkTarget?: string;
  symlinkResolution?: SymlinkResolution;
};

export type LinkType = "hardlink" | "symlink";
export type LinkSourceKind = "file" | "directory" | "symlink" | "other";
export type LinkErrorCode =
  | "target_exists"
  | "missing_source"
  | "source_changed"
  | "unsupported_source"
  | "special_entry"
  | "cross_filesystem"
  | "destination_inside_source"
  | "outside_root"
  | "invalid_path"
  | "operation_failed";

export type LinkRequest = {
  type: LinkType;
  sourceRoot: string;
  sources: string[];
  destRoot: string;
  destPath: string;
};

export type LinkJobRequest = LinkRequest & {
  previewRevision: string;
};

export type LinkCounts = {
  directories: number;
  files: number;
  symlinks: number;
};

export type LinkPreviewItem = {
  sourcePath: string;
  destPath: string;
  sourceKind: LinkSourceKind;
  counts: LinkCounts;
  conflict: boolean;
  errorCode?: LinkErrorCode;
  errorText?: string;
};

export type LinkPreview = {
  type: LinkType;
  sourceRoot: string;
  destRoot: string;
  destPath: string;
  previewRevision: string;
  progressTotal: number;
  hasConflict: boolean;
  items: LinkPreviewItem[];
};

export type RenameOptions = {
  readMetadata: boolean;
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
  type: "move" | "copy" | "delete" | "mkdir";
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
  transfer?: { phase: string; file: string; bytesDone: number; bytesTotal: number; bytesPerSecond: number; remainingSeconds?: number; cancelable: boolean; percent?: number };
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

export type TextEncoding =
  | "utf-8"
  | "utf-8-bom"
  | "utf-16le-bom"
  | "utf-16be-bom"
  | "gb18030";

export type TextLineEnding = "lf" | "crlf" | "cr" | "mixed" | "none";
export type TextWritableLineEnding = Exclude<TextLineEnding, "mixed" | "none">;

export type TextDocument = {
  content: string;
  encoding: TextEncoding;
  lineEnding: TextLineEnding;
  preferredLineEnding: TextWritableLineEnding;
  byteSize: number;
  revision: string;
};

export type TextSaveRequest = {
  rootId: string;
  path: string;
  content: string;
  encoding: TextEncoding;
  lineEnding: TextWritableLineEnding;
  revision: string;
  force: boolean;
};

export type TextSaveResult = {
  byteSize: number;
  revision: string;
};

export type SuperRenameMediaKind = "image" | "video";
export type SuperRenameEntryKind = "file" | "directory" | "symlink" | "other";
export type SuperRenameUnmatchedReason =
  | "unsupported-extension"
  | "nested-directory"
  | "symlink"
  | "special";
export type SuperRenameVideoDirectoryStatus = "missing" | "directory" | "blocking-entry";

export type SuperRenameCandidate = {
  sourcePath: string;
  name: string;
  extension: string;
  mediaKind: SuperRenameMediaKind;
};

export type SuperRenameUnmatched = {
  path: string;
  name: string;
  kind: SuperRenameEntryKind;
  reason: SuperRenameUnmatchedReason;
};

export type SuperRenameDirectoryRef = {
  path: string;
  name: string;
};

export type SuperRenameVideoDirectory = {
  status: SuperRenameVideoDirectoryStatus;
  path: string;
  occupiedPaths: string[];
};

export type SuperRenameInventoryGroup = {
  path: string;
  name: string;
  images: SuperRenameCandidate[];
  videos: SuperRenameCandidate[];
  unmatched: SuperRenameUnmatched[];
  childDirectories: SuperRenameDirectoryRef[];
  directOccupiedPaths: string[];
  videoDirectory: SuperRenameVideoDirectory;
  recoveryResidues: string[];
};

export type SuperRenameInventory = {
  rootId: string;
  directoryPath: string;
  generatedAtUnix: number;
  groups: SuperRenameInventoryGroup[];
};

export type SuperRenamePreviewRequest = {
  rootId: string;
  directoryPath: string;
};

export type SuperRenameGroupPreviewRequest = SuperRenamePreviewRequest & {
  groupPath: string;
};

export type SuperRenameCreateJobRequest = SuperRenamePreviewRequest & {
  selectedPaths: string[];
};
