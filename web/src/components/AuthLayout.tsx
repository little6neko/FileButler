import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function AuthLayout({ title, description, languageControl, children }: {
  title: string;
  description: string;
  languageControl?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-full flex-col items-center bg-slate-50 p-5 pt-[max(20px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]">
      <Card className="my-auto w-full max-w-md shrink-0 shadow-lg shadow-slate-200/60">
        <CardHeader>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <CardTitle className="min-w-0"><h1>{title}</h1></CardTitle>
            {languageControl ? <div className="shrink-0 [&_[data-slot=select-trigger]]:w-28">{languageControl}</div> : null}
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
