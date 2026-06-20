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
  jobs: string;
  refresh: string;
  clear: string;
  selectAllVisible: string;
  name: string;
  type: string;
  size: string;
  modified: string;
  pathLabel(title: string): string;
  rootLabel(title: string): string;
  refreshLabel(title: string): string;
  selectEntry(name: string): string;
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
    jobs: "Jobs",
    refresh: "Refresh",
    clear: "Clear",
    selectAllVisible: "Select all visible",
    name: "Name",
    type: "Type",
    size: "Size",
    modified: "Modified",
    pathLabel: (title) => `${title} path`,
    rootLabel: (title) => `${title} root`,
    refreshLabel: (title) => `${title} refresh`,
    selectEntry: (name) => `Select ${name}`,
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
    jobs: "任务",
    refresh: "刷新",
    clear: "清除",
    selectAllVisible: "全选可见文件",
    name: "名称",
    type: "类型",
    size: "大小",
    modified: "修改时间",
    pathLabel: (title) => `${title}路径`,
    rootLabel: (title) => `${title}根目录`,
    refreshLabel: (title) => `${title}刷新`,
    selectEntry: (name) => `选择 ${name}`,
  },
};

export function resolveLanguage(mode: LanguageMode, browserLanguages: readonly string[] = navigator.languages): Language {
  if (mode === "en" || mode === "zh-CN") return mode;
  return browserLanguages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}
