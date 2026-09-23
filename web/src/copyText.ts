export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // The Clipboard API is unavailable on plain HTTP LAN test addresses.
  const previousFocus = document.activeElement;
  const input = document.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand?.("copy")) throw new Error("Clipboard copy failed");
  } finally {
    input.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  }
}
