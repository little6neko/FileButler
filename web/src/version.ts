export function formatAppVersion(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return "dev";
  return normalized.startsWith("v") ? normalized : `v${normalized}`;
}

export const appVersion = formatAppVersion(import.meta.env.VITE_APP_VERSION);
