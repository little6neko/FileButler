import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { api } from "../api/client";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { AuthLayout } from "./AuthLayout";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  labels?: UIStrings;
  languageControl?: ReactNode;
  onLoggedIn(): void;
};

export function LoginScreen({ labels = strings.en, languageControl, onLoggedIn }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(username.trim(), password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.loginFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title={labels.administratorLogin} description={labels.loginDescription} languageControl={languageControl}>
      <form className="grid gap-4" onSubmit={onSubmit}>
        <ErrorBanner message={error} />
        <div className="grid gap-2">
          <Label htmlFor="login-username">{labels.username}</Label>
          <Input id="login-username" value={username} onChange={(event) => setUsername(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="login-password">{labels.password}</Label>
          <Input id="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? <LoaderCircle className="animate-spin" /> : null}
          {labels.logIn}
        </Button>
      </form>
    </AuthLayout>
  );
}
