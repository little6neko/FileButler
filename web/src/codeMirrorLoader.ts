import type * as CommandsModule from "@codemirror/commands";
import type * as LanguageModule from "@codemirror/language";
import type * as LanguageDataModule from "@codemirror/language-data";
import type * as SearchModule from "@codemirror/search";
import type * as StateModule from "@codemirror/state";
import type * as ViewModule from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { codeMirrorLanguageDescriptionName, type TextLanguage } from "./textFiles";

export type CodeMirrorCore = {
  state: typeof StateModule;
  view: typeof ViewModule;
  commands: typeof CommandsModule;
  search: typeof SearchModule;
  language: typeof LanguageModule;
};

export type CodeMirrorLanguageResult = {
  extension: Extension | null;
  degraded: boolean;
};

type CodeMirrorLoaderDependencies = {
  loadState(): Promise<typeof StateModule>;
  loadView(): Promise<typeof ViewModule>;
  loadCommands(): Promise<typeof CommandsModule>;
  loadSearch(): Promise<typeof SearchModule>;
  loadLanguage(): Promise<typeof LanguageModule>;
  loadLanguageData(): Promise<typeof LanguageDataModule.languages>;
};

const defaultDependencies: CodeMirrorLoaderDependencies = {
  loadState: () => import("@codemirror/state"),
  loadView: () => import("@codemirror/view"),
  loadCommands: () => import("@codemirror/commands"),
  loadSearch: () => import("@codemirror/search"),
  loadLanguage: () => import("@codemirror/language"),
  loadLanguageData: () => import("@codemirror/language-data").then((module) => module.languages),
};

export class CodeMirrorLoader {
  private readonly dependencies: CodeMirrorLoaderDependencies;
  private corePromise: Promise<CodeMirrorCore> | null = null;
  private languageDataPromise: Promise<typeof LanguageDataModule.languages> | null = null;
  private readonly languagePromises = new Map<string, Promise<CodeMirrorLanguageResult>>();

  constructor(dependencies: Partial<CodeMirrorLoaderDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  loadCore(): Promise<CodeMirrorCore> {
    if (!this.corePromise) {
      this.corePromise = Promise.all([
        this.dependencies.loadState(),
        this.dependencies.loadView(),
        this.dependencies.loadCommands(),
        this.dependencies.loadSearch(),
        this.dependencies.loadLanguage(),
      ]).then(([state, view, commands, search, language]) => ({ state, view, commands, search, language }));
    }
    return this.corePromise;
  }

  loadLanguage(language: TextLanguage, automaticFileName?: string): Promise<CodeMirrorLanguageResult> {
    const descriptionName = codeMirrorLanguageDescriptionName(language, automaticFileName);
    if (descriptionName === null) {
      return Promise.resolve({ extension: null, degraded: false });
    }

    const cacheKey = descriptionName.toLowerCase();
    const cached = this.languagePromises.get(cacheKey);
    if (cached) return cached;
    const promise = this.getLanguageData()
      .then((descriptions) => {
        const description = descriptions.find((candidate) => candidate.name.toLowerCase() === cacheKey);
        if (!description) return { extension: null, degraded: true };
        return description.load()
          .then((extension) => ({ extension, degraded: false }))
          .catch(() => ({ extension: null, degraded: true }));
      })
      .catch(() => ({ extension: null, degraded: true }));
    this.languagePromises.set(cacheKey, promise);
    return promise;
  }

  private getLanguageData() {
    if (!this.languageDataPromise) this.languageDataPromise = this.dependencies.loadLanguageData();
    return this.languageDataPromise;
  }
}

export function createCodeMirrorLoader(dependencies: Partial<CodeMirrorLoaderDependencies> = {}) {
  return new CodeMirrorLoader(dependencies);
}

export const codeMirrorLoader = createCodeMirrorLoader();
