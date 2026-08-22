import type { LanguageMode, UIStrings } from "../i18n";
import type { JobEventsStore } from "../jobEvents";
import { FileWorkspace } from "./FileWorkspace";

export function DualPane({
  labels,
  languageMode,
  onLanguageModeChange,
  jobEventsStore,
}: {
  labels?: UIStrings;
  languageMode?: LanguageMode;
  onLanguageModeChange?(mode: LanguageMode): void;
  jobEventsStore?: JobEventsStore;
}) {
  return (
    <FileWorkspace
      labels={labels}
      languageMode={languageMode}
      onLanguageModeChange={onLanguageModeChange}
      jobEventsStore={jobEventsStore}
      initialMode="compact"
      persistMode={false}
    />
  );
}
