import { useEffect, useState } from "react";
import { api } from "./api/client";
import { DualPane } from "./components/DualPane";
import { InitScreen } from "./components/InitScreen";
import { LoginScreen } from "./components/LoginScreen";

type AppState = "loading" | "init" | "login" | "ready";

export default function App() {
  const [state, setState] = useState<AppState>("loading");

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
          <p>Self-hosted file operations</p>
        </div>
      </header>
      {state === "loading" && (
        <section className="empty-state">
          <h2>Loading workspace</h2>
        </section>
      )}
      {state === "init" && <InitScreen onInitialized={() => setState("ready")} />}
      {state === "login" && <LoginScreen onLoggedIn={() => setState("ready")} />}
      {state === "ready" && <DualPane />}
    </main>
  );
}
