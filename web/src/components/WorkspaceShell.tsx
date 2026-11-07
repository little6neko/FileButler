import { useState, type ReactNode } from "react";
import { useWorkspaceViewport } from "../workspaceViewport";
import { useMobileBack } from "../mobileBack";
import { Cloud, Columns2, FileCode2, FileImage, FileVideo, Files, Info, Languages, ListChecks, MonitorUp, ScanText, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UIStrings } from "../i18n";
import type { MediaKind } from "../media";
import { appVersion } from "../version";
import type { WindowStatus } from "../windowManager";

export type WorkspaceMode = "compact" | "desktop";

export type TaskbarWindow = {
  id: string;
  kind: "file" | "powerRename" | "mediaPreview" | "textEditor" | "superRename" | "cloud115" | "cloudPreview" | "details";
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
  onMobileHome,
  activeCompactPane = "left",
  onCompactPaneChange,
  onWindowClose,
  onMobileCloud,
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
  onMobileHome?(): void;
  activeCompactPane?: "left" | "right";
  onCompactPaneChange?(pane: "left" | "right"): void;
  onWindowClose?(id: string): void;
  onMobileCloud?(): void;
}) {
  const { mobile } = useWorkspaceViewport();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  useMobileBack(switcherOpen, () => setSwitcherOpen(false));
  return (
    <main className="workspace-shell" data-workspace-mode={mode} data-mobile={mobile}>
      <header className="system-taskbar" hidden={mobile}>
        <div className="taskbar-brand" title="FileButler" aria-hidden="true">F</div>
        <h1 className="sr-only">FileButler</h1>
        <nav aria-label={labels.taskbar} className="taskbar-windows">
          {mode === "compact" ? (
            <Button size="sm" variant="ghost" aria-current="page" aria-expanded="true" className="taskbar-window-button">
              <Files />
              <span>{labels.fileManager}</span>
            </Button>
          ) : null}
          {windows.filter((window) => mode !== "compact" || window.kind === "details").map((window) => {
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
                  : window.kind === "details" ? <Info />
                  : window.kind === "cloud115" ? <Cloud />
                  : window.kind === "superRename" ? <WandSparkles />
                  : window.kind === "cloudPreview" && !window.mediaKind ? <FileCode2 />
                  : window.kind === "mediaPreview" || window.kind === "cloudPreview"
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
      <section className="workspace-shell-content" inert={mobile && (switcherOpen || jobsOpen)} aria-hidden={mobile && (switcherOpen || jobsOpen) ? true : undefined}>{children}</section>
      {mobile ? <>
        {switcherOpen ? <section className="mobile-window-switcher" aria-label={labels.taskbar}>
          <header><strong>{labels.mobileWindows}</strong><Button variant="outline" onClick={() => setSwitcherOpen(false)}>{labels.cancel}</Button></header>
          {mode === "compact" ? <div className="mobile-pane-switcher">
            {(["left", "right"] as const).map(pane => <Button key={pane} variant="outline" aria-pressed={activeCompactPane === pane} onClick={() => { onCompactPaneChange?.(pane); setSwitcherOpen(false); }}>{pane === "left" ? labels.leftPane : labels.rightPane}</Button>)}
          </div> : null}
          {onMobileCloud ? <Button variant="outline" onClick={() => { onMobileCloud(); setSwitcherOpen(false); }}><Cloud />115网盘</Button> : null}
          {windows.map(window => <div key={window.id} className="flex items-center gap-2">
            <Button variant="outline" className="mobile-window-choice" aria-current={window.id === activeWindowId ? "page" : undefined} onClick={() => { if (window.id !== activeWindowId || window.status === "minimized") onWindowActivate(window.id); setSwitcherOpen(false); }}>{window.title}</Button>
            {onWindowClose ? <Button variant="ghost" aria-label={`${labels.closeWindow}: ${window.title}`} onClick={() => { onWindowClose(window.id); setSwitcherOpen(false); }}>×</Button> : null}
          </div>)}
          <footer>{languageControl}<small>FileButler {version}</small></footer>
        </section> : null}
        <nav className="mobile-bottom-navigation" aria-label={labels.workspaceNavigation}>
          <Button variant="ghost" onClick={() => { if (jobsOpen) onJobsToggle(); setSwitcherOpen(false); onMobileHome?.(); }}><Files />{labels.fileManager}</Button>
          <Button variant="ghost" aria-expanded={switcherOpen} onClick={() => { if (jobsOpen) onJobsToggle(); setSwitcherOpen(open => !open); }}><Columns2 />{labels.mobileWindows}</Button>
          <Button variant="ghost" aria-expanded={jobsOpen} onClick={() => { setSwitcherOpen(false); onJobsToggle(); }}><ListChecks />{labels.activeJobs(activeJobCount)}</Button>
        </nav>
      </> : null}
    </main>
  );
}
