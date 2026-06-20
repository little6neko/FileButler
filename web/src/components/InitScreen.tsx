import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  onInitialized(): void;
};

export function InitScreen({ onInitialized }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      setError("Username is required");
      return;
    }
    if (password.length < 10) {
      setError("Password must be at least 10 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createAdmin(trimmed, password);
      onInitialized();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Initialization failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-screen">
      <form className="auth-form" onSubmit={onSubmit}>
        <h2>Initialize administrator</h2>
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
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
        <button type="submit" disabled={submitting}>
          Create administrator
        </button>
      </form>
    </section>
  );
}
