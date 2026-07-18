import type { ReactNode } from "react";
import { BriefcaseBusiness, Files, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UIStrings } from "../i18n";

export function AppShell({
  labels,
  activeJobCount,
  onJobsOpen,
  languageControl,
  children,
}: {
  labels: UIStrings;
  activeJobCount: number;
  onJobsOpen(): void;
  languageControl: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="grid h-screen min-w-[1024px] grid-cols-[54px_minmax(0,1fr)] overflow-hidden bg-slate-100">
      <nav aria-label={labels.workspaceNavigation} className="flex flex-col items-center border-r bg-white px-2 py-2.5">
        <div className="mb-4 grid size-8 place-items-center rounded-lg bg-blue-600 font-bold text-white shadow-sm">F</div>
        <Button aria-current="page" aria-label={labels.files} title={labels.files} size="icon" variant="secondary"><Files /></Button>
        <Button aria-label={labels.jobs} title={labels.jobs} size="icon" variant="ghost" onClick={onJobsOpen}><ListChecks /></Button>
      </nav>
      <section className="grid min-w-0 grid-rows-[48px_minmax(0,1fr)] overflow-hidden">
        <header className="flex items-center gap-3 border-b bg-white px-4">
          <BriefcaseBusiness className="size-4 text-blue-600" />
          <div><h1 className="text-sm font-semibold leading-none">FileButler</h1><p className="mt-1 text-[11px] text-slate-500">{labels.workspace}</p></div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onJobsOpen}><ListChecks />{labels.activeJobs(activeJobCount)}</Button>
            {languageControl}
          </div>
        </header>
        <div className="min-h-0 overflow-hidden">{children}</div>
      </section>
    </main>
  );
}
