import { useEffect, useState } from "react";
import { api } from "./api/client";
import { DualPane } from "./components/DualPane";
import { InitScreen } from "./components/InitScreen";
import { LanguageSelect } from "./components/LanguageSelect";
import { LoginScreen } from "./components/LoginScreen";
import { resolveLanguage, strings } from "./i18n";
import type { LanguageMode } from "./i18n";

type AppState = "loading" | "init" | "login" | "ready";

export default function App() {
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
    return <DualPane labels={t} languageMode={languageMode} onLanguageModeChange={setLanguageMode} />;
  }

  return (
    <div className="relative h-screen min-w-[1024px] overflow-hidden">
      <div className="absolute right-4 top-4 z-20">
        <LanguageSelect value={languageMode} onChange={setLanguageMode} labels={t} />
      </div>
      {state === "loading" ? (
        <main className="grid h-full place-items-center bg-slate-50 text-sm text-slate-500">{t.loadingWorkspace}</main>
      ) : null}
      {state === "init" ? <InitScreen labels={t} onInitialized={() => setState("ready")} /> : null}
      {state === "login" ? <LoginScreen labels={t} onLoggedIn={() => setState("ready")} /> : null}
    </div>
  );
}
