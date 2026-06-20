export type LanguageMode = "auto" | "en" | "zh-CN";
export type Language = "en" | "zh-CN";

export type UIStrings = {
  subtitle: string;
  language: string;
  languageAuto: string;
  languageEnglish: string;
  languageChinese: string;
  loadingWorkspace: string;
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
  jobs: string;
  refresh: string;
  resizePanes: string;
  selectAllVisible: string;
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
  jobCreationFailed: string;
  batchRename: string;
  renameDialog: string;
  search: string;
  replace: string;
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
  selectEntry(name: string): string;
  operationPreview(type: string): string;
  operationType(type: string): string;
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
    jobs: "Jobs",
    refresh: "Refresh",
    resizePanes: "Resize panes",
    selectAllVisible: "Select all visible",
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
    jobCreationFailed: "Job creation failed",
    batchRename: "Batch rename",
    renameDialog: "Rename dialog",
    search: "Search",
    replace: "Replace",
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
    selectEntry: (name) => `Select ${name}`,
    operationPreview: (type) => `${type} preview`,
    operationType: (type) => type,
    jobStatus: (status) => status,
  },
  "zh-CN": {
    subtitle: "自托管文件操作",
    language: "语言",
    languageAuto: "自动",
    languageEnglish: "English",
    languageChinese: "简体中文",
    loadingWorkspace: "正在加载工作区",
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
    jobs: "任务",
    refresh: "刷新",
    resizePanes: "调整左右栏宽度",
    selectAllVisible: "全选可见文件",
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
    jobCreationFailed: "创建任务失败",
    batchRename: "批量重命名",
    renameDialog: "重命名窗口",
    search: "搜索",
    replace: "替换",
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
    selectEntry: (name) => `选择 ${name}`,
    operationPreview: (type) => `${strings["zh-CN"].operationType(type)}预览`,
    operationType: (type) =>
      ({
        move: "移动",
        copy: "复制",
        symlink: "软链接",
        hardlink: "硬链接",
        delete: "删除",
        mkdir: "新建文件夹",
      })[type] ?? type,
    jobStatus: (status) =>
      ({
        pending: "等待中",
        running: "运行中",
        cancel_requested: "正在取消",
        canceled: "已取消",
        completed: "已完成",
        failed: "失败",
      })[status] ?? status,
  },
};

export function resolveLanguage(mode: LanguageMode, browserLanguages: readonly string[] = navigator.languages): Language {
  if (mode === "en" || mode === "zh-CN") return mode;
  return browserLanguages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}
