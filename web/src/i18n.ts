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
  delete: string;
  mkdir: string;
  rename: string;
  powerRename: string;
  powerRenameWindowTitle(count: number): string;
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
  mediaPreview: string;
  previousMedia: string;
  nextMedia: string;
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
    delete: "delete",
    mkdir: "mkdir",
    rename: "Rename",
    powerRename: "PowerRename",
    powerRenameWindowTitle: (count) => `PowerRename — ${count} ${count === 1 ? "item" : "items"}`,
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
    mediaPreview: "Media preview",
    previousMedia: "Previous media",
    nextMedia: "Next media",
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
    delete: "删除",
    mkdir: "新建文件夹",
    rename: "重命名",
    powerRename: "PowerRename",
    powerRenameWindowTitle: (count) => `PowerRename — ${count} 项`,
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
    mediaPreview: "媒体预览",
    previousMedia: "上一个媒体",
    nextMedia: "下一个媒体",
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
