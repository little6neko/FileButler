import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  onLoggedIn(): void;
};

export function LoginScreen({ onLoggedIn }: Props) {
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
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-screen">
      <form className="auth-form" onSubmit={onSubmit}>
        <h2>Administrator login</h2>
        <ErrorBanner message={error} />
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" disabled={submitting}>
          Log in
        </button>
      </form>
    </section>
  );
}
