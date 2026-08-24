import type { ReactNode } from "react";
import { Columns2, FileCode2, FileImage, FileVideo, Files, Languages, ListChecks, MonitorUp, ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UIStrings } from "../i18n";
import type { MediaKind } from "../media";
import { appVersion } from "../version";
import type { WindowStatus } from "../windowManager";

export type WorkspaceMode = "compact" | "desktop";

export type TaskbarWindow = {
  id: string;
  kind: "file" | "powerRename" | "mediaPreview" | "textEditor";
  mediaKind?: MediaKind;
  title: string;
  status: WindowStatus;
};

export function WorkspaceShell({
  labels,
  mode,
  windows,
  activeWindowId,
  activeJobCount,
  jobsOpen,
  onModeChange,
  onWindowActivate,
  onJobsToggle,
  languageControl,
  version = appVersion,
  children,
}: {
  labels: UIStrings;
  mode: WorkspaceMode;
  windows: TaskbarWindow[];
  activeWindowId: string | null;
  activeJobCount: number;
  jobsOpen: boolean;
  onModeChange(mode: WorkspaceMode): void;
  onWindowActivate(id: string): void;
  onJobsToggle(): void;
  languageControl: ReactNode;
  version?: string;
  children: ReactNode;
}) {
  return (
    <main className="workspace-shell">
      <header className="system-taskbar">
        <div className="taskbar-brand" title="FileButler" aria-hidden="true">F</div>
        <h1 className="sr-only">FileButler</h1>
        <nav aria-label={labels.taskbar} className="taskbar-windows">
          {mode === "compact" ? (
            <Button size="sm" variant="ghost" aria-current="page" aria-expanded="true" className="taskbar-window-button">
              <Files />
              <span>{labels.fileManager}</span>
            </Button>
          ) : windows.map((window) => {
            const active = activeWindowId === window.id && window.status !== "minimized";
            return (
              <Button
                key={window.id}
                size="sm"
                variant="ghost"
                aria-current={active ? "page" : undefined}
                aria-expanded={window.status !== "minimized"}
                data-window-status={window.status}
                data-window-kind={window.kind}
                className="taskbar-window-button"
                title={window.title}
                onClick={() => onWindowActivate(window.id)}
              >
                {window.kind === "powerRename" ? <ScanText />
                  : window.kind === "mediaPreview"
                    ? window.mediaKind === "video" ? <FileVideo /> : <FileImage />
                    : window.kind === "textEditor" ? <FileCode2 />
                    : <Files />}
                <span>{window.title}</span>
              </Button>
            );
          })}
        </nav>
        <Button size="sm" variant="outline" onClick={onJobsToggle} aria-label={labels.jobs} aria-expanded={jobsOpen}>
          <ListChecks />
          <span>{labels.activeJobs(activeJobCount)}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="taskbar-mode-button"
          aria-label={mode === "desktop" ? labels.switchToCompact : labels.switchToDesktop}
          onClick={() => onModeChange(mode === "desktop" ? "compact" : "desktop")}
        >
          {mode === "desktop" ? <Columns2 /> : <MonitorUp />}
          <span>{mode === "desktop" ? labels.compactMode : labels.desktopMode}</span>
        </Button>
        <span className="taskbar-language-icon" aria-hidden="true"><Languages /></span>
        {languageControl}
        <span className="taskbar-version" title={`FileButler ${version}`}>{version}</span>
      </header>
      <section className="workspace-shell-content">{children}</section>
    </main>
  );
}
