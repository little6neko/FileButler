import type { ReactNode } from "react";
import type { UIStrings } from "../i18n";

export function AuthLayout({ labels, children }: { labels: UIStrings; children: ReactNode }) {
  return (
    <main className="grid min-h-screen grid-cols-[minmax(320px,0.85fr)_minmax(480px,1.15fr)] bg-slate-50">
      <section className="flex flex-col bg-gradient-to-br from-blue-800 via-blue-600 to-sky-400 p-10 text-white">
        <div className="grid size-11 place-items-center rounded-xl bg-white/15 text-lg font-bold">F</div>
        <div className="mt-auto max-w-md">
          <p className="mb-3 text-sm font-semibold text-blue-100">FileButler</p>
          <h1 className="text-3xl font-semibold tracking-tight">{labels.authTagline}</h1>
          <p className="mt-3 text-sm leading-6 text-blue-100">{labels.authDescription}</p>
        </div>
      </section>
      <section className="grid place-items-center p-10">{children}</section>
    </main>
  );
}
