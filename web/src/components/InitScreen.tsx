import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api/client";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { AuthLayout } from "./AuthLayout";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  labels?: UIStrings;
  onInitialized(): void;
};

export function InitScreen({ labels = strings.en, onInitialized }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      setError(labels.usernameRequired);
      return;
    }
    if (password.length < 10) {
      setError(labels.passwordTooShort);
      return;
    }
    if (password !== confirmPassword) {
      setError(labels.passwordMismatch);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createAdmin(trimmed, password);
      onInitialized();
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.initializationFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout labels={labels}>
      <Card className="w-full max-w-md shadow-lg shadow-slate-200/60">
        <CardHeader>
          <CardTitle><h2>{labels.initializeAdministrator}</h2></CardTitle>
          <CardDescription>{labels.initializeDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <ErrorBanner message={error} />
            <div className="grid gap-2">
              <Label htmlFor="init-username">{labels.username}</Label>
              <Input id="init-username" value={username} onChange={(event) => setUsername(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="init-password">{labels.password}</Label>
              <Input id="init-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="init-confirm-password">{labels.confirmPassword}</Label>
              <Input id="init-confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="animate-spin" /> : null}
              {labels.createAdministrator}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
