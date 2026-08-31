export type LanguageMode = "auto" | "en" | "zh-CN";
export type Language = "en" | "zh-CN";

export type UIStrings = {
  subtitle: string;
  language: string;
  languageAuto: string;
  languageEnglish: string;
  languageChinese: string;
  loadingWorkspace: string;
  authTagline: string;
  authDescription: string;
  administratorLogin: string;
  loginDescription: string;
  initializeAdministrator: string;
  initializeDescription: string;
  username: string;
  password: string;
  confirmPassword: string;
  logIn: string;
  createAdministrator: string;
  usernameRequired: string;
  passwordTooShort: string;
  passwordMismatch: string;
  loginFailed: string;
  initializationFailed: string;
  workspace: string;
  workspaceNavigation: string;
  taskbar: string;
  desktopMode: string;
  compactMode: string;
  switchToDesktop: string;
  switchToCompact: string;
  fileManager: string;
  allLocations: string;
  mappedLocations: string;
  openFileManager: string;
  noMappedRoots: string;
  minimizeWindow: string;
  maximizeWindow: string;
  restoreWindow: string;
  closeWindow: string;
  openInNewWindow: string;
  clipboardCopy: string;
  cut: string;
  paste: string;
  clipboardCopied(count: number): string;
  clipboardCut(count: number): string;
  clipboardSelectionRequired: string;
  clipboardEmpty: string;
  pasteUnavailable: string;
  fileActions: string;
  files: string;
  activeJobs(count: number): string;
  copyToPane(pane: string): string;
  moveToPane(pane: string): string;
  selectionSummary(count: number): string;
  leftPane: string;
  rightPane: string;
  move: string;
  copy: string;
  symlink: string;
  hardlink: string;
  selectLinkSource: string;
  cancelLinkSource(count: number): string;
  createLinkAs: string;
  linkSourceSelected(count: number): string;
  linkSourceRequired: string;
  linkSourceEntry(name: string): string;
  delete: string;
  mkdir: string;
  rename: string;
  powerRename: string;
  powerRenameWindowTitle(count: number): string;
  superRename: string;
  superRenameWindowTitle(directory: string): string;
  superRenameDescription: string;
  superRenameSummary(groups: number, selected: number, unmatched: number, conflicts: number): string;
  superRenameCurrentItem: string;
  superRenamePlannedResult: string;
  superRenameNoMatches: string;
  superRenameNotLoaded: string;
  superRenameLoadingGroup: string;
  superRenameLoadedNotSelected: string;
  superRenameGroupCompleted: string;
  superRenameGroupLoadFailed: string;
  superRenameCanceled: string;
  superRenameUnchanged: string;
  superRenameNotRecursive: string;
  superRenameUnsupported: string;
  superRenameSymlink: string;
  superRenameSpecial: string;
  superRenameRecoveryRequired: string;
  superRenameVideoWillCreate: string;
  superRenameVideoWillReuse: string;
  superRenameVideoBlocked: string;
  superRenameSelectGroup(name: string): string;
  superRenameSelectItem(name: string): string;
  superRenameExpandGroup(name: string): string;
  superRenameCollapseGroup(name: string): string;
  superRenameGroupAction: string;
  superRenameGroupSubmit(name: string): string;
  superRenameExecute(count: number): string;
  superRenameConfirmationRequired: string;
  superRenameConflict(code: string): string;
  jobs: string;
  allJobs: string;
  runningJobs: string;
  completedJobs: string;
  emptyJobs: string;
  jobsReconnecting: string;
  cancelJob(type: string): string;
  cancelJobFailed: string;
  jobProgress(type: string): string;
  failedItems(count: number): string;
  refresh: string;
  resizePanes: string;
  selectAllVisible: string;
  selectedItems(count: number): string;
  visibleItems(count: number): string;
  noSelection: string;
  emptyDirectory: string;
  currentDirectory: string;
  browseFailed: string;
  name: string;
  type: string;
  entryFolderType: string;
  entryFileType: string;
  entrySymlinkType: string;
  entryOtherType: string;
  size: string;
  modified: string;
  close: string;
  loading: string;
  source: string;
  destination: string;
  status: string;
  ready: string;
  confirm: string;
  previewFailed: string;
  linkPreviewTitle(type: string): string;
  linkPreviewDescription(type: string, count: number): string;
  linkSourceKind(kind: string): string;
  linkPlannedWork: string;
  linkCounts(directories: number, files: number, symlinks: number): string;
  linkCreate(type: string, count: number): string;
  linkConfirmationRequired: string;
  linkError(code: string): string;
  mediaPreview: string;
  previousMedia: string;
  nextMedia: string;
  textEditor: string;
  textEditorLabel(name: string): string;
  save: string;
  editorLoading: string;
  editorUnavailable: string;
  editorSaving: string;
  editorSaved: string;
  editorUnsaved: string;
  editorLargeFile: string;
  editorDocumentTooLarge: string;
  editorHighlightUnavailable: string;
  editorSyntaxHighlight: string;
  editorSyntaxAuto(language: string): string;
  editorSyntaxLoading(language: string): string;
  editorSyntaxLargeFile: string;
  editorConflictTitle: string;
  editorConflictDescription(name: string): string;
  editorReload: string;
  editorOverwrite: string;
  editorUnsavedTitle: string;
  editorUnsavedDescription(name: string): string;
  discardChanges: string;
  editorLineColumn(line: number, column: number): string;
  editorMixedLineEnding: string;
  editorNoLineEnding: string;
  jobCreationFailed: string;
  batchRename: string;
  renameDialog: string;
  livePreview: string;
  renamePreviewSummary(changed: number, total: number): string;
  renameItems(count: number): string;
  search: string;
  replace: string;
  searchPresets: string;
  replacePresets: string;
  regex: string;
  useRegularExpressions: string;
  caseSensitive: string;
  matchAll: string;
  matchAllOccurrences: string;
  target: string;
  targetName: string;
  targetExtension: string;
  targetBoth: string;
  includeFiles: string;
  includeFolders: string;
  includeSubfolders: string;
  excludeFiles: string;
  excludeFolders: string;
  excludeSubfolders: string;
  enumerate: string;
  enumerateItems: string;
  nameOnly: string;
  extensionOnly: string;
  fullName: string;
  textTransform: string;
  uppercase: string;
  lowercase: string;
  titlecase: string;
  capitalized: string;
  randomizeItems: string;
  old: string;
  new: string;
  runRename: string;
  renameFailed: string;
  cancel: string;
  directoryNamePrompt: string;
  newName: string;
  pathLabel(title: string): string;
  rootLabel(title: string): string;
  refreshLabel(title: string): string;
  back: string;
  forward: string;
  up: string;
  backToFolder(folder: string): string;
  forwardToFolder(folder: string): string;
  upToFolder(folder: string): string;
  hiddenPathSegments(count: number): string;
  selectEntry(name: string): string;
  operationMode: string;
  operationPreview(type: string): string;
  operationDescription(type: string, count: number): string;
  confirmOperation(type: string, count: number): string;
  deleteWarning: string;
  conflictsFound(count: number): string;
  jobCreated: string;
  operationType(type: string): string;
  dragSummary(name: string, count: number): string;
  dragDestination(type: string, target: string): string;
  dragStarted(name: string, count: number): string;
  dragOver(target: string): string;
  dragDropped(target: string): string;
  dragCanceled: string;
  invalidDrop(reason: string): string;
  jobStatus(status: string): string;
};

export const strings: Record<Language, UIStrings> = {
  en: {
    subtitle: "Self-hosted file operations",
    language: "Language",
    languageAuto: "Auto",
    languageEnglish: "English",
    languageChinese: "简体中文",
    loadingWorkspace: "Loading workspace",
    authTagline: "Keep file work under control",
    authDescription: "A secure, self-hosted dual-pane file workspace.",
    administratorLogin: "Administrator login",
    loginDescription: "Sign in to continue to FileButler.",
    initializeAdministrator: "Initialize administrator",
    initializeDescription: "Create the first administrator account for this installation.",
    username: "Username",
    password: "Password",
    confirmPassword: "Confirm password",
    logIn: "Log in",
    createAdministrator: "Create administrator",
    usernameRequired: "Username is required",
    passwordTooShort: "Password must be at least 10 characters",
    passwordMismatch: "Passwords do not match",
    loginFailed: "Login failed",
    initializationFailed: "Initialization failed",
    workspace: "Dual-pane file workspace",
    workspaceNavigation: "Workspace navigation",
    taskbar: "System taskbar",
    desktopMode: "Full mode",
    compactMode: "Compact mode",
    switchToDesktop: "Switch to full mode",
    switchToCompact: "Switch to compact mode",
    fileManager: "File Manager",
    allLocations: "All locations",
    mappedLocations: "Mapped locations",
    openFileManager: "Open File Manager",
    noMappedRoots: "No mapped roots are configured",
    minimizeWindow: "Minimize window",
    maximizeWindow: "Maximize window",
    restoreWindow: "Restore window",
    closeWindow: "Close window",
    openInNewWindow: "Open in new window",
    clipboardCopy: "Copy",
    cut: "Cut",
    paste: "Paste",
    clipboardCopied: (count) => `Copied ${count} ${count === 1 ? "item" : "items"}`,
    clipboardCut: (count) => `Cut ${count} ${count === 1 ? "item" : "items"}`,
    clipboardSelectionRequired: "Select one or more items first",
    clipboardEmpty: "The app clipboard is empty",
    pasteUnavailable: "Choose a mapped location before pasting",
    fileActions: "File actions",
    files: "Files",
    activeJobs: (count) => `${count} active ${count === 1 ? "job" : "jobs"}`,
    copyToPane: (pane) => `Copy to ${pane.toLowerCase()}`,
    moveToPane: (pane) => `Move to ${pane.toLowerCase()}`,
    selectionSummary: (count) => `${count} selected`,
    leftPane: "Left pane",
    rightPane: "Right pane",
    move: "move",
    copy: "copy",
    symlink: "symlink",
    hardlink: "hardlink",
    selectLinkSource: "Select link source",
    cancelLinkSource: (count) => `Cancel selected link source (${count})`,
    createLinkAs: "Create as…",
    linkSourceSelected: (count) => `Selected ${count} ${count === 1 ? "link source" : "link sources"}`,
    linkSourceRequired: "Select one or more link sources first",
    linkSourceEntry: (name) => `${name} is a selected link source`,
    delete: "delete",
    mkdir: "mkdir",
    rename: "Rename",
    powerRename: "PowerRename",
    powerRenameWindowTitle: (count) => `PowerRename — ${count} ${count === 1 ? "item" : "items"}`,
    superRename: "SuperRename",
    superRenameWindowTitle: (directory) => `SuperRename — ${directory}`,
    superRenameDescription: "Number direct images and videos independently in each folder; nested folders participate only when selected.",
    superRenameSummary: (groups, selected, unmatched, conflicts) => `${groups} folders · ${selected} selected · ${unmatched} unmatched · ${conflicts} conflicts`,
    superRenameCurrentItem: "Current item",
    superRenamePlannedResult: "Planned result",
    superRenameNoMatches: "No matching media",
    superRenameNotLoaded: "Not loaded · not selected",
    superRenameLoadingGroup: "Loading folder…",
    superRenameLoadedNotSelected: "Loaded · not selected",
    superRenameGroupCompleted: "This folder is complete",
    superRenameGroupLoadFailed: "Load failed · expand or select to retry",
    superRenameCanceled: "Canceled",
    superRenameUnchanged: "Unchanged",
    superRenameNotRecursive: "Not scanned recursively",
    superRenameUnsupported: "Unsupported file type",
    superRenameSymlink: "Symbolic link is not followed",
    superRenameSpecial: "Special file is not supported",
    superRenameRecoveryRequired: "Manual recovery required",
    superRenameVideoWillCreate: "Video folder will be created",
    superRenameVideoWillReuse: "Existing video folder will be reused",
    superRenameVideoBlocked: "Video path is not a folder",
    superRenameSelectGroup: (name) => `Select all matched media in ${name}`,
    superRenameSelectItem: (name) => `Select ${name} for SuperRename`,
    superRenameExpandGroup: (name) => `Expand ${name}`,
    superRenameCollapseGroup: (name) => `Collapse ${name}`,
    superRenameGroupAction: "Folder action",
    superRenameGroupSubmit: (name) => `Rename ${name} now`,
    superRenameExecute: (count) => `Rename ${count} ${count === 1 ? "file" : "files"}`,
    superRenameConfirmationRequired: "The directory changed. Review the refreshed preview and confirm again.",
    superRenameConflict: (code) => ({
      target_occupied: "Target is occupied",
      duplicate_target: "Duplicate target",
      video_directory_blocked: "Video path is blocked",
      recovery_required: "Manual recovery required",
    })[code] ?? "Conflict",
    jobs: "Jobs",
    allJobs: "All",
    runningJobs: "Running",
    completedJobs: "Completed",
    emptyJobs: "No background jobs yet",
    jobsReconnecting: "Reconnecting",
    cancelJob: (type) => `Cancel ${type} job`,
    cancelJobFailed: "Unable to cancel this job",
    jobProgress: (type) => `${strings.en.operationType(type)} progress`,
    failedItems: (count) => `${count} ${count === 1 ? "item" : "items"} failed`,
    refresh: "Refresh",
    resizePanes: "Resize panes",
    selectAllVisible: "Select all visible",
    selectedItems: (count) => `${count} selected`,
    visibleItems: (count) => `${count} ${count === 1 ? "item" : "items"}`,
    noSelection: "No selection",
    emptyDirectory: "This directory is empty",
    currentDirectory: "Current directory",
    browseFailed: "Unable to load this directory",
    name: "Name",
    type: "Type",
    entryFolderType: "Folder",
    entryFileType: "File",
    entrySymlinkType: "Symbolic link",
    entryOtherType: "Other",
    size: "Size",
    modified: "Modified",
    close: "Close",
    loading: "Loading",
    source: "Source",
    destination: "Destination",
    status: "Status",
    ready: "Ready",
    confirm: "Confirm",
    previewFailed: "Preview failed",
    linkPreviewTitle: (type) => `${type === "hardlink" ? "Hard link" : "Symbolic link"} preview`,
    linkPreviewDescription: (type, count) => `Review ${count} top-level ${count === 1 ? "source" : "sources"} before creating ${type === "hardlink" ? "hard links" : "symbolic links"}.`,
    linkSourceKind: (kind) => ({
      file: "File",
      directory: "Folder",
      symlink: "Symbolic link",
      other: "Other",
    })[kind] ?? kind,
    linkPlannedWork: "Planned work",
    linkCounts: (directories, files, symlinks) => [
      directories ? `${directories} ${directories === 1 ? "folder" : "folders"}` : "",
      files ? `${files} hard-linked ${files === 1 ? "file" : "files"}` : "",
      symlinks ? `${symlinks} symbolic ${symlinks === 1 ? "link" : "links"}` : "",
    ].filter(Boolean).join(" · "),
    linkCreate: (type, count) => type === "hardlink"
      ? `Create ${count === 1 ? "hard link" : "hard links"}`
      : `Create ${count === 1 ? "symbolic link" : "symbolic links"}`,
    linkConfirmationRequired: "The source or destination changed. Review the refreshed preview and confirm again.",
    linkError: (code) => ({
      target_exists: "The destination already exists",
      missing_source: "The source no longer exists",
      source_changed: "The source changed after preview",
      unsupported_source: "This source type cannot be linked",
      special_entry: "A special file is not supported",
      cross_filesystem: "Hard links require the same filesystem",
      destination_inside_source: "The destination is inside the source folder",
      outside_root: "The path is outside mapped locations",
      invalid_path: "The source or destination path is invalid",
      operation_failed: "The link operation failed",
      stale_preview: "The link preview is out of date",
      plan_conflict: "The link plan contains conflicts",
    })[code] ?? "",
    mediaPreview: "Media preview",
    previousMedia: "Previous media",
    nextMedia: "Next media",
    textEditor: "Text editor",
    textEditorLabel: (name) => `Edit ${name}`,
    save: "Save",
    editorLoading: "Loading editor…",
    editorUnavailable: "The text editor could not be loaded.",
    editorSaving: "Saving…",
    editorSaved: "Saved",
    editorUnsaved: "Unsaved changes",
    editorLargeFile: "Large file: syntax highlighting is disabled.",
    editorDocumentTooLarge: "Syntax highlighting was disabled because the document grew beyond the safe limit.",
    editorHighlightUnavailable: "Syntax highlighting is unavailable; editing continues as plain text.",
    editorSyntaxHighlight: "Syntax highlighting",
    editorSyntaxAuto: (language) => `Auto (${language})`,
    editorSyntaxLoading: (language) => `Loading ${language}…`,
    editorSyntaxLargeFile: "Plain Text (large file)",
    editorConflictTitle: "File changed on disk",
    editorConflictDescription: (name) => `${name} was changed outside FileButler. Reload the disk version or overwrite it with your saved edit?`,
    editorReload: "Reload",
    editorOverwrite: "Overwrite anyway",
    editorUnsavedTitle: "Unsaved changes",
    editorUnsavedDescription: (name) => `${name} has changes that have not been saved. Save them before closing?`,
    discardChanges: "Don't save",
    editorLineColumn: (line, column) => `Line ${line}, column ${column}`,
    editorMixedLineEnding: "Mixed",
    editorNoLineEnding: "None",
    jobCreationFailed: "Job creation failed",
    batchRename: "Batch rename",
    renameDialog: "Rename dialog",
    livePreview: "Live preview",
    renamePreviewSummary: (changed, total) => `${changed} changes · ${total} items`,
    renameItems: (count) => `Rename ${count} ${count === 1 ? "item" : "items"}`,
    search: "Search",
    replace: "Replace",
    searchPresets: "Search presets",
    replacePresets: "Replace presets",
    regex: "Regex",
    useRegularExpressions: "Use regular expressions",
    caseSensitive: "Case-sensitive",
    matchAll: "Match all",
    matchAllOccurrences: "Match all occurrences",
    target: "Target",
    targetName: "name",
    targetExtension: "extension",
    targetBoth: "both",
    includeFiles: "Include files",
    includeFolders: "Include folders",
    includeSubfolders: "Include subfolders",
    excludeFiles: "Exclude files",
    excludeFolders: "Exclude folders",
    excludeSubfolders: "Exclude subfolders",
    enumerate: "Enumerate",
    enumerateItems: "Enumerate items",
    nameOnly: "Name only",
    extensionOnly: "Extension only",
    fullName: "Full name",
    textTransform: "Text case",
    uppercase: "Uppercase",
    lowercase: "Lowercase",
    titlecase: "Titlecase",
    capitalized: "Capitalized",
    randomizeItems: "Randomize items",
    old: "Old",
    new: "New",
    runRename: "Run rename",
    renameFailed: "Rename failed",
    cancel: "Cancel",
    directoryNamePrompt: "Directory name",
    newName: "New name",
    pathLabel: (title) => `${title} path`,
    rootLabel: (title) => `${title} root`,
    refreshLabel: (title) => `${title} refresh`,
    back: "Back",
    forward: "Forward",
    up: "Up",
    backToFolder: (folder) => `Back to "${folder}"`,
    forwardToFolder: (folder) => `Forward to "${folder}"`,
    upToFolder: (folder) => `Up to "${folder}"`,
    hiddenPathSegments: (count) => `Show ${count} hidden folders`,
    selectEntry: (name) => `Select ${name}`,
    operationMode: "Operation",
    operationPreview: (type) => `${type} preview`,
    operationDescription: (type, count) => `${strings.en.operationType(type)} ${count} ${count === 1 ? "item" : "items"}`,
    confirmOperation: (type, count) =>
      type === "delete" ? `Delete ${count} ${count === 1 ? "item" : "items"}` : `Start ${strings.en.operationType(type)}`,
    deleteWarning: "Deleted items cannot be restored by FileButler.",
    conflictsFound: (count) => `${count} ${count === 1 ? "conflict" : "conflicts"} must be resolved before continuing.`,
    jobCreated: "Background job created",
    operationType: (type) =>
      ({
        rename: "Rename",
        power_rename: "PowerRename",
        super_rename: "SuperRename",
      })[type] ?? type,
    dragSummary: (name, count) => count === 1 ? name : `${name} and ${count - 1} more`,
    dragDestination: (type, target) => `${strings.en.operationType(type)} to ${target}`,
    dragStarted: (name, count) => count === 1 ? `Started dragging ${name}` : `Started dragging ${name} and ${count - 1} more`,
    dragOver: (target) => `Over ${target}`,
    dragDropped: (target) => `Dropped on ${target}`,
    dragCanceled: "Drag canceled",
    invalidDrop: (reason) => reason === "same-directory"
      ? "The selected items are already in this directory"
      : "A folder cannot be placed inside itself or one of its subfolders",
    jobStatus: (status) =>
      ({
        pending: "Pending",
        running: "Running",
        cancel_requested: "Canceling",
        canceled: "Canceled",
        completed: "Completed",
        completed_with_errors: "Completed with errors",
        failed: "Failed",
        interrupted: "Interrupted",
      })[status] ?? status,
  },
  "zh-CN": {
    subtitle: "自托管文件操作",
    language: "语言",
    languageAuto: "自动",
    languageEnglish: "English",
    languageChinese: "简体中文",
    loadingWorkspace: "正在加载工作区",
    authTagline: "让文件整理更从容",
    authDescription: "安全、自托管的双栏文件工作台。",
    administratorLogin: "管理员登录",
    loginDescription: "登录以进入 FileButler。",
    initializeAdministrator: "初始化管理员",
    initializeDescription: "为当前 FileButler 实例创建首个管理员账户。",
    username: "用户名",
    password: "密码",
    confirmPassword: "确认密码",
    logIn: "登录",
    createAdministrator: "创建管理员",
    usernameRequired: "请输入用户名",
    passwordTooShort: "密码长度至少为 10 个字符",
    passwordMismatch: "两次输入的密码不一致",
    loginFailed: "登录失败",
    initializationFailed: "初始化失败",
    workspace: "双栏文件工作台",
    workspaceNavigation: "工作区导航",
    taskbar: "系统任务栏",
    desktopMode: "完整模式",
    compactMode: "精简模式",
    switchToDesktop: "切换到完整模式",
    switchToCompact: "切换到精简模式",
    fileManager: "文件管理器",
    allLocations: "所有位置",
    mappedLocations: "映射位置",
    openFileManager: "打开文件管理器",
    noMappedRoots: "尚未配置映射根目录",
    minimizeWindow: "最小化窗口",
    maximizeWindow: "最大化窗口",
    restoreWindow: "还原窗口",
    closeWindow: "关闭窗口",
    openInNewWindow: "在新窗口中打开",
    clipboardCopy: "复制",
    cut: "剪切",
    paste: "粘贴",
    clipboardCopied: (count) => `已复制 ${count} 项`,
    clipboardCut: (count) => `已剪切 ${count} 项`,
    clipboardSelectionRequired: "请先选择一个或多个项目",
    clipboardEmpty: "应用内剪贴板为空",
    pasteUnavailable: "请先进入一个映射位置再粘贴",
    fileActions: "文件操作",
    files: "文件",
    activeJobs: (count) => `${count} 个任务运行中`,
    copyToPane: (pane) => `复制到${pane}`,
    moveToPane: (pane) => `移动到${pane}`,
    selectionSummary: (count) => `已选择 ${count} 项`,
    leftPane: "左栏",
    rightPane: "右栏",
    move: "移动",
    copy: "复制",
    symlink: "软链接",
    hardlink: "硬链接",
    selectLinkSource: "选择源连接点",
    cancelLinkSource: (count) => `取消选定的连接（${count} 项）`,
    createLinkAs: "创建为…",
    linkSourceSelected: (count) => `已选择 ${count} 个连接源`,
    linkSourceRequired: "请先选择一个或多个连接源",
    linkSourceEntry: (name) => `${name} 是已选连接源`,
    delete: "删除",
    mkdir: "新建文件夹",
    rename: "重命名",
    powerRename: "PowerRename",
    powerRenameWindowTitle: (count) => `PowerRename — ${count} 项`,
    superRename: "SuperRename",
    superRenameWindowTitle: (directory) => `SuperRename — ${directory}`,
    superRenameDescription: "按每个文件夹分别为直属图片和视频连续编号；深层文件夹仅在主动勾选后参与。",
    superRenameSummary: (groups, selected, unmatched, conflicts) => `${groups} 个文件夹 · 已选 ${selected} 项 · ${unmatched} 项未匹配 · ${conflicts} 个冲突`,
    superRenameCurrentItem: "当前项目",
    superRenamePlannedResult: "计划结果",
    superRenameNoMatches: "无匹配媒体",
    superRenameNotLoaded: "未加载 · 默认不参与",
    superRenameLoadingGroup: "正在加载文件夹…",
    superRenameLoadedNotSelected: "已加载 · 未选择",
    superRenameGroupCompleted: "本层已完成",
    superRenameGroupLoadFailed: "加载失败 · 展开或勾选可重试",
    superRenameCanceled: "已取消",
    superRenameUnchanged: "无需更改",
    superRenameNotRecursive: "不递归处理",
    superRenameUnsupported: "不支持的文件类型",
    superRenameSymlink: "不跟随符号链接",
    superRenameSpecial: "不支持特殊文件",
    superRenameRecoveryRequired: "需要手动恢复",
    superRenameVideoWillCreate: "将新建“视频”文件夹",
    superRenameVideoWillReuse: "将复用已有“视频”文件夹",
    superRenameVideoBlocked: "“视频”路径不是文件夹",
    superRenameSelectGroup: (name) => `选择 ${name} 中的全部匹配媒体`,
    superRenameSelectItem: (name) => `选择 ${name} 进行 SuperRename`,
    superRenameExpandGroup: (name) => `展开 ${name}`,
    superRenameCollapseGroup: (name) => `折叠 ${name}`,
    superRenameGroupAction: "文件夹操作",
    superRenameGroupSubmit: (name) => `立即重命名 ${name}`,
    superRenameExecute: (count) => `重命名 ${count} 个文件`,
    superRenameConfirmationRequired: "目录内容已变化，请检查刷新后的预览并再次确认。",
    superRenameConflict: (code) => ({
      target_occupied: "目标已被占用",
      duplicate_target: "目标名称重复",
      video_directory_blocked: "“视频”路径被阻塞",
      recovery_required: "需要手动恢复",
    })[code] ?? "存在冲突",
    jobs: "任务",
    allJobs: "全部",
    runningJobs: "进行中",
    completedJobs: "已完成",
    emptyJobs: "暂无后台任务",
    jobsReconnecting: "正在重新连接",
    cancelJob: (type) => `取消${type}任务`,
    cancelJobFailed: "取消任务失败",
    jobProgress: (type) => `${strings["zh-CN"].operationType(type)}进度`,
    failedItems: (count) => `${count} 项失败`,
    refresh: "刷新",
    resizePanes: "调整左右栏宽度",
    selectAllVisible: "全选可见文件",
    selectedItems: (count) => `已选择 ${count} 项`,
    visibleItems: (count) => `共 ${count} 项`,
    noSelection: "未选择",
    emptyDirectory: "当前文件夹为空",
    currentDirectory: "当前文件夹",
    browseFailed: "无法加载当前文件夹",
    name: "名称",
    type: "类型",
    entryFolderType: "文件夹",
    entryFileType: "文件",
    entrySymlinkType: "符号链接",
    entryOtherType: "其他",
    size: "大小",
    modified: "修改时间",
    close: "关闭",
    loading: "加载中",
    source: "来源",
    destination: "目标",
    status: "状态",
    ready: "就绪",
    confirm: "确认",
    previewFailed: "预览失败",
    linkPreviewTitle: (type) => `${type === "hardlink" ? "硬链接" : "软链接"}预览`,
    linkPreviewDescription: (type, count) => `创建${type === "hardlink" ? "硬链接" : "软链接"}前，请检查 ${count} 个顶层来源。`,
    linkSourceKind: (kind) => ({
      file: "文件",
      directory: "文件夹",
      symlink: "符号链接",
      other: "其他",
    })[kind] ?? kind,
    linkPlannedWork: "计划内容",
    linkCounts: (directories, files, symlinks) => [
      directories ? `${directories} 个文件夹` : "",
      files ? `${files} 个硬链接文件` : "",
      symlinks ? `${symlinks} 个符号链接` : "",
    ].filter(Boolean).join(" · "),
    linkCreate: (type, count) => `创建 ${count} 个${type === "hardlink" ? "硬链接" : "软链接"}`,
    linkConfirmationRequired: "来源或目标已经变化，请检查刷新后的预览并再次确认。",
    linkError: (code) => ({
      target_exists: "目标已存在",
      missing_source: "来源已不存在",
      source_changed: "来源在预览后发生了变化",
      unsupported_source: "不支持为该来源创建链接",
      special_entry: "不支持特殊文件",
      cross_filesystem: "硬链接必须位于同一文件系统",
      destination_inside_source: "目标位于来源文件夹内部",
      outside_root: "路径位于映射位置之外",
      invalid_path: "来源或目标路径无效",
      operation_failed: "创建链接失败",
      stale_preview: "链接预览已过期",
      plan_conflict: "链接计划存在冲突",
    })[code] ?? "",
    mediaPreview: "媒体预览",
    previousMedia: "上一个媒体",
    nextMedia: "下一个媒体",
    textEditor: "文本编辑器",
    textEditorLabel: (name) => `编辑 ${name}`,
    save: "保存",
    editorLoading: "正在加载编辑器…",
    editorUnavailable: "无法加载文本编辑器。",
    editorSaving: "正在保存…",
    editorSaved: "已保存",
    editorUnsaved: "有未保存的更改",
    editorLargeFile: "文件较大，已关闭语法高亮。",
    editorDocumentTooLarge: "文档超过安全大小，已关闭语法高亮。",
    editorHighlightUnavailable: "语法高亮不可用，已切换为纯文本编辑。",
    editorSyntaxHighlight: "语法高亮",
    editorSyntaxAuto: (language) => `自动（${language}）`,
    editorSyntaxLoading: (language) => `正在加载 ${language}…`,
    editorSyntaxLargeFile: "纯文本（大文件）",
    editorConflictTitle: "文件已在磁盘上更改",
    editorConflictDescription: (name) => `${name} 已在 FileButler 外部被修改。要重新载入磁盘版本，还是用当前编辑内容覆盖？`,
    editorReload: "重新载入",
    editorOverwrite: "仍然覆盖",
    editorUnsavedTitle: "有未保存的更改",
    editorUnsavedDescription: (name) => `${name} 包含尚未保存的更改。是否在关闭前保存？`,
    discardChanges: "不保存",
    editorLineColumn: (line, column) => `第 ${line} 行，第 ${column} 列`,
    editorMixedLineEnding: "混合",
    editorNoLineEnding: "无",
    jobCreationFailed: "创建任务失败",
    batchRename: "批量重命名",
    renameDialog: "重命名窗口",
    livePreview: "实时预览",
    renamePreviewSummary: (changed, total) => `${changed} 项更改 · 共 ${total} 项`,
    renameItems: (count) => `重命名 ${count} 项`,
    search: "搜索",
    replace: "替换",
    searchPresets: "搜索预设",
    replacePresets: "替换预设",
    regex: "正则",
    useRegularExpressions: "使用正则表达式",
    caseSensitive: "区分大小写",
    matchAll: "全部匹配",
    matchAllOccurrences: "匹配所有出现项",
    target: "目标",
    targetName: "名称",
    targetExtension: "扩展名",
    targetBoth: "名称和扩展名",
    includeFiles: "包含文件",
    includeFolders: "包含文件夹",
    includeSubfolders: "包含子文件夹",
    excludeFiles: "排除文件",
    excludeFolders: "排除文件夹",
    excludeSubfolders: "排除子文件夹",
    enumerate: "编号",
    enumerateItems: "编号项目",
    nameOnly: "仅文件名",
    extensionOnly: "仅扩展名",
    fullName: "全名称",
    textTransform: "大小写",
    uppercase: "大写",
    lowercase: "小写",
    titlecase: "标题大小写",
    capitalized: "首字母大写",
    randomizeItems: "随机化项目",
    old: "原名称",
    new: "新名称",
    runRename: "运行重命名",
    renameFailed: "重命名失败",
    cancel: "取消",
    directoryNamePrompt: "文件夹名称",
    newName: "新名称",
    pathLabel: (title) => `${title}路径`,
    rootLabel: (title) => `${title}根目录`,
    refreshLabel: (title) => `${title}刷新`,
    back: "返回",
    forward: "前进",
    up: "上移",
    backToFolder: (folder) => `返回到“${folder}”`,
    forwardToFolder: (folder) => `前进到“${folder}”`,
    upToFolder: (folder) => `上移到“${folder}”`,
    hiddenPathSegments: (count) => `显示 ${count} 个隐藏文件夹`,
    selectEntry: (name) => `选择 ${name}`,
    operationMode: "操作方式",
    operationPreview: (type) => `${strings["zh-CN"].operationType(type)}预览`,
    operationDescription: (type, count) => `${strings["zh-CN"].operationType(type)} ${count} 项`,
    confirmOperation: (type, count) =>
      type === "delete" ? `删除 ${count} 项` : `开始${strings["zh-CN"].operationType(type)}`,
    deleteWarning: "FileButler 无法恢复已删除的项目。",
    conflictsFound: (count) => `发现 ${count} 个冲突，解决后才能继续。`,
    jobCreated: "后台任务已创建",
    operationType: (type) =>
      ({
        move: "移动",
        copy: "复制",
        symlink: "软链接",
        hardlink: "硬链接",
        delete: "删除",
        mkdir: "新建文件夹",
        rename: "重命名",
        power_rename: "PowerRename",
        super_rename: "SuperRename",
      })[type] ?? type,
    dragSummary: (name, count) => count === 1 ? name : `${name} 等 ${count} 项`,
    dragDestination: (type, target) => `${strings["zh-CN"].operationType(type)}到${target}`,
    dragStarted: (name, count) => count === 1 ? `开始拖动 ${name}` : `开始拖动 ${name} 等 ${count} 项`,
    dragOver: (target) => `位于${target}上方`,
    dragDropped: (target) => `已放入${target}`,
    dragCanceled: "已取消拖动",
    invalidDrop: (reason) => reason === "same-directory"
      ? "所选项目已在当前文件夹中"
      : "不能将文件夹放入自身或其子文件夹",
    jobStatus: (status) =>
      ({
        pending: "等待中",
        running: "运行中",
        cancel_requested: "正在取消",
        canceled: "已取消",
        completed: "已完成",
        completed_with_errors: "完成但有错误",
        failed: "失败",
        interrupted: "已中断",
      })[status] ?? status,
  },
};

export function resolveLanguage(mode: LanguageMode, browserLanguages: readonly string[] = navigator.languages): Language {
  if (mode === "en" || mode === "zh-CN") return mode;
  return browserLanguages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}
