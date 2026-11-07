import type { ReactNode } from "react";
import type { UIStrings } from "../i18n";

export function AuthLayout({ labels, children }: { labels: UIStrings; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh grid-cols-1 bg-slate-50 md:grid-cols-[minmax(320px,0.85fr)_minmax(480px,1.15fr)]">
      <section className="flex flex-col bg-gradient-to-br from-blue-800 via-blue-600 to-sky-400 p-6 pt-16 text-white md:p-10">
        <div className="grid size-11 place-items-center rounded-xl bg-white/15 text-lg font-bold">F</div>
        <div className="mt-auto max-w-md">
          <p className="mb-3 text-sm font-semibold text-blue-100">FileButler</p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{labels.authTagline}</h1>
          <p className="mt-3 text-sm leading-6 text-blue-100">{labels.authDescription}</p>
        </div>
      </section>
      <section className="grid min-w-0 place-items-center p-5 pb-[max(20px,env(safe-area-inset-bottom))] md:p-10">{children}</section>
    </main>
  );
}
