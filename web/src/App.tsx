import { useEffect, useState } from "react";
import { api } from "./api/client";
import { DualPane } from "./components/DualPane";
import { InitScreen } from "./components/InitScreen";
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>FileButler</h1>
          <p>{t.subtitle}</p>
        </div>
        <label className="language-select">
          {t.language}
          <select
            aria-label="Language"
            value={languageMode}
            onChange={(event) => setLanguageMode(event.target.value as LanguageMode)}
          >
            <option value="auto">{t.languageAuto}</option>
            <option value="en">{t.languageEnglish}</option>
            <option value="zh-CN">{t.languageChinese}</option>
          </select>
        </label>
      </header>
      {state === "loading" && (
        <section className="empty-state">
          <h2>{t.loadingWorkspace}</h2>
        </section>
      )}
      {state === "init" && <InitScreen labels={t} onInitialized={() => setState("ready")} />}
      {state === "login" && <LoginScreen labels={t} onLoggedIn={() => setState("ready")} />}
      {state === "ready" && <DualPane labels={t} />}
    </main>
  );
}
