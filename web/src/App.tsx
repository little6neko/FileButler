import { useEffect, useState } from "react";
import { api } from "./api/client";
import { FileWorkspace } from "./components/FileWorkspace";
import { InitScreen } from "./components/InitScreen";
import { JobEventsProvider } from "./components/JobEventsProvider";
import { LanguageSelect } from "./components/LanguageSelect";
import { LoginScreen } from "./components/LoginScreen";
import { resolveLanguage, strings } from "./i18n";
import type { LanguageMode } from "./i18n";
import { useMobileViewportHeight } from "./workspaceViewport";

type AppState = "loading" | "init" | "login" | "ready";

export default function App() {
  useMobileViewportHeight();
  const [state, setState] = useState<AppState>("loading");
  const [languageMode, setLanguageMode] = useState<LanguageMode>("auto");
  const t = strings[resolveLanguage(languageMode)];

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const init = await api.initStatus();
        if (!active) return;
        if (init.needsInitialization) {
          setState("init");
          return;
        }
        await api.me();
        if (active) setState("ready");
      } catch {
        if (active) setState("login");
      }
    }
    void boot();
    return () => {
      active = false;
    };
  }, []);

  if (state === "ready") {
    return (
      <JobEventsProvider labels={t}>
        <FileWorkspace labels={t} languageMode={languageMode} onLanguageModeChange={setLanguageMode} />
      </JobEventsProvider>
    );
  }

  return (
    <div className="auth-screen relative h-dvh min-w-0 overflow-auto">
      {state === "loading" ? (
        <main className="grid h-full place-items-center bg-slate-50 text-sm text-slate-500">{t.loadingWorkspace}</main>
      ) : null}
      {state === "init" ? <InitScreen labels={t} languageControl={<LanguageSelect value={languageMode} onChange={setLanguageMode} labels={t} />} onInitialized={() => setState("ready")} /> : null}
      {state === "login" ? <LoginScreen labels={t} languageControl={<LanguageSelect value={languageMode} onChange={setLanguageMode} labels={t} />} onLoggedIn={() => setState("ready")} /> : null}
    </div>
  );
}
