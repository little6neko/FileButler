# FileButler shadcn/ui Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace FileButler's plain desktop UI with the approved shadcn/ui workbench while preserving every existing file-operation workflow.

**Architecture:** Keep `App` responsible for boot and language state and keep `DualPane` responsible for pane and operation orchestration. Introduce focused presentational components for the application shell, action toolbar, pane status, jobs sheet, and shared dialog primitives; retain the existing API types and backend endpoints unchanged.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Tailwind CSS 4, shadcn/ui, Radix UI, Lucide React, Sonner, Vitest, Testing Library, Playwright, Go.

---

## File Structure

Create or replace the following focused units during the plan:

- `web/components.json`: shadcn/ui generator configuration.
- `web/src/lib/utils.ts`: shared `cn()` class-name utility generated for shadcn/ui.
- `web/src/components/ui/*.tsx`: generated shadcn/ui primitives; do not put FileButler business logic in this directory.
- `web/src/components/AuthLayout.tsx`: branded split layout shared by initialization and login.
- `web/src/components/AppShell.tsx`: desktop rail and top-bar frame around the ready workspace.
- `web/src/components/ActionToolbar.tsx`: direction-aware operation buttons and selection summary.
- `web/src/components/FileIcon.tsx`: Lucide icon selection for entries.
- `web/src/components/PaneStatusBar.tsx`: selected count, selected bytes, and visible count.
- `web/src/components/JobsSheet.tsx`: polling job list, selected-job detail, progress, and cancel action.
- `web/src/components/ErrorBanner.tsx`: shadcn Alert wrapper preserving `role="alert"`.

Modify existing orchestration rather than introducing global state:

- `web/src/App.tsx`: boot states, language selector wiring, auth screens, and ready-state props.
- `web/src/components/DualPane.tsx`: active pane, action derivation, dialogs, job-sheet state, and pane refresh.
- `web/src/components/FilePane.tsx`: compact table presentation while preserving navigation, sorting, resizing, and drag selection.
- Existing dialog components: switch markup to shadcn primitives while preserving API calls and local state.
- `web/src/i18n.ts`: add all new visible copy in English and Simplified Chinese.
- `web/src/styles.css`: Tailwind import, shadcn tokens, desktop shell rules, and the minimal custom CSS required for resizable tables and drag selection.

Do not modify Go endpoints, `web/src/api/client.ts`, or `web/src/api/types.ts` unless a failing test proves a type mismatch. The approved design uses data already returned by the current API.

### Task 1: Install and Verify the shadcn/ui Foundation

**Files:**
- Create: `web/components.json`
- Create: `web/src/lib/utils.ts`
- Create: `web/src/components/ui/alert.tsx`
- Create: `web/src/components/ui/badge.tsx`
- Create: `web/src/components/ui/button.tsx`
- Create: `web/src/components/ui/card.tsx`
- Create: `web/src/components/ui/checkbox.tsx`
- Create: `web/src/components/ui/dialog.tsx`
- Create: `web/src/components/ui/input.tsx`
- Create: `web/src/components/ui/label.tsx`
- Create: `web/src/components/ui/progress.tsx`
- Create: `web/src/components/ui/select.tsx`
- Create: `web/src/components/ui/separator.tsx`
- Create: `web/src/components/ui/sheet.tsx`
- Create: `web/src/components/ui/skeleton.tsx`
- Create: `web/src/components/ui/table.tsx`
- Create: `web/src/components/ui/tooltip.tsx`
- Create: `web/src/components/ui/sonner.tsx`
- Create: `web/src/components/ui-foundation.test.tsx`
- Modify: `web/package.json`
- Modify: `web/package-lock.json`
- Modify: `web/vite.config.ts`
- Modify: `web/tsconfig.app.json`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Add a failing smoke test for the shared primitives**

Create `web/src/components/ui-foundation.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

it("renders shadcn buttons and an accessible dialog", async () => {
  const onOpenChange = vi.fn();
  render(
    <>
      <Button variant="destructive">Delete</Button>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Operation preview</DialogTitle>
        </DialogContent>
      </Dialog>
    </>,
  );

  expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("data-variant", "destructive");
  expect(screen.getByRole("dialog", { name: "Operation preview" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 2: Run the smoke test and verify the imports fail**

Run:

```bash
npm --prefix web test -- --run src/components/ui-foundation.test.tsx
```

Expected: FAIL because `@/components/ui/button` and `@/components/ui/dialog` do not exist and the `@` alias is not configured.

- [ ] **Step 3: Configure Tailwind, aliases, and shadcn/ui**

Run:

```bash
npm --prefix web install tailwindcss @tailwindcss/vite
cd web
npx shadcn@latest init -d
npx shadcn@latest add alert badge button card checkbox dialog input label progress select separator sheet skeleton table tooltip sonner
```

Set `web/components.json` to:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

Add the alias to `web/tsconfig.app.json` inside `compilerOptions`:

```json
"baseUrl": ".",
"paths": {
  "@/*": ["./src/*"]
}
```

Replace `web/vite.config.ts` with:

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/.git/**", "e2e/**"],
  },
});
```

Confirm the generated `Button` forwards `data-variant` so the test remains stable:

```tsx
<Comp
  data-slot="button"
  data-variant={variant}
  data-size={size}
  className={cn(buttonVariants({ variant, size, className }))}
  ref={ref}
  {...props}
/>
```

- [ ] **Step 4: Replace the global stylesheet with the approved base tokens**

Keep the shadcn-generated token declarations and set the top of `web/src/styles.css` to:

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--foreground);
  background: var(--background);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  --radius: 0.5rem;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  width: 100%;
  height: 100%;
  min-width: 1024px;
}

body {
  margin: 0;
  overflow: hidden;
}

button,
input,
select {
  font: inherit;
}
```

Do not add dark-mode colors beyond the generated variables; the application does not expose a theme toggle.

- [ ] **Step 5: Run the smoke test and the existing frontend suite**

Run:

```bash
npm --prefix web test -- --run src/components/ui-foundation.test.tsx
npm --prefix web test -- --run
```

Expected: the primitive smoke test and existing suite pass. Retain the legacy component rules below the new token block until Task 8 removes them, so no commit in this plan intentionally leaves tests failing.

- [ ] **Step 6: Commit the UI foundation**

```bash
git add web/package.json web/package-lock.json web/components.json web/vite.config.ts web/tsconfig.app.json web/src/styles.css web/src/lib web/src/components/ui web/src/components/ui-foundation.test.tsx
git commit -m "build: add shadcn ui foundation"
```

### Task 2: Redesign Initialization and Login

**Files:**
- Create: `web/src/components/AuthLayout.tsx`
- Create: `web/src/components/AuthLayout.test.tsx`
- Modify: `web/src/components/LoginScreen.tsx`
- Modify: `web/src/components/LoginScreen.test.tsx`
- Modify: `web/src/components/InitScreen.tsx`
- Modify: `web/src/components/InitScreen.test.tsx`
- Modify: `web/src/components/ErrorBanner.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`
- Modify: `web/src/i18n.ts`

- [ ] **Step 1: Write failing tests for translated branded auth screens**

Create `web/src/components/AuthLayout.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { strings } from "../i18n";
import { AuthLayout } from "./AuthLayout";

it("renders FileButler branding around auth content", () => {
  render(
    <AuthLayout labels={strings["zh-CN"]}>
      <p>form</p>
    </AuthLayout>,
  );

  expect(screen.getByText("FileButler")).toBeInTheDocument();
  expect(screen.getByText("让文件整理更从容")).toBeInTheDocument();
  expect(screen.getByText("form")).toBeInTheDocument();
});
```

Append to `web/src/components/LoginScreen.test.tsx`:

```tsx
import { strings } from "../i18n";

it("renders the login form in Chinese", () => {
  render(<LoginScreen labels={strings["zh-CN"]} onLoggedIn={vi.fn()} />);

  expect(screen.getByRole("heading", { name: "管理员登录" })).toBeInTheDocument();
  expect(screen.getByLabelText("用户名")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
});
```

Append to `web/src/components/InitScreen.test.tsx`:

```tsx
import { strings } from "../i18n";

it("renders the initialization form in Chinese", () => {
  render(<InitScreen labels={strings["zh-CN"]} onInitialized={vi.fn()} />);

  expect(screen.getByRole("heading", { name: "初始化管理员" })).toBeInTheDocument();
  expect(screen.getByLabelText("确认密码")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "创建管理员" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the auth tests and verify they fail**

Run:

```bash
npm --prefix web test -- --run src/components/AuthLayout.test.tsx src/components/LoginScreen.test.tsx src/components/InitScreen.test.tsx
```

Expected: FAIL because `AuthLayout` and the `labels` props do not exist.

- [ ] **Step 3: Add the auth copy to `UIStrings`**

Add these exact fields to `UIStrings`:

```ts
authTagline: string;
authDescription: string;
administratorLogin: string;
loginDescription: string;
initializeAdministrator: string;
initializeDescription: string;
username: string;
password: string;
confirmPassword: string;
logIn: string;
createAdministrator: string;
usernameRequired: string;
passwordTooShort: string;
passwordMismatch: string;
loginFailed: string;
initializationFailed: string;
```

Add these values to `strings.en`:

```ts
authTagline: "Keep file work under control",
authDescription: "A secure, self-hosted dual-pane file workspace.",
administratorLogin: "Administrator login",
loginDescription: "Sign in to continue to FileButler.",
initializeAdministrator: "Initialize administrator",
initializeDescription: "Create the first administrator account for this installation.",
username: "Username",
password: "Password",
confirmPassword: "Confirm password",
logIn: "Log in",
createAdministrator: "Create administrator",
usernameRequired: "Username is required",
passwordTooShort: "Password must be at least 10 characters",
passwordMismatch: "Passwords do not match",
loginFailed: "Login failed",
initializationFailed: "Initialization failed",
```

Add these values to `strings["zh-CN"]`:

```ts
authTagline: "让文件整理更从容",
authDescription: "安全、自托管的双栏文件工作台。",
administratorLogin: "管理员登录",
loginDescription: "登录以进入 FileButler。",
initializeAdministrator: "初始化管理员",
initializeDescription: "为当前 FileButler 实例创建首个管理员账户。",
username: "用户名",
password: "密码",
confirmPassword: "确认密码",
logIn: "登录",
createAdministrator: "创建管理员",
usernameRequired: "请输入用户名",
passwordTooShort: "密码长度至少为 10 个字符",
passwordMismatch: "两次输入的密码不一致",
loginFailed: "登录失败",
initializationFailed: "初始化失败",
```

- [ ] **Step 4: Implement the shared auth layout and Alert wrapper**

Create `web/src/components/AuthLayout.tsx`:

```tsx
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
```

Replace `web/src/components/ErrorBanner.tsx` with:

```tsx
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CircleAlert } from "lucide-react";

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 5: Convert LoginScreen and InitScreen to shadcn Cards**

Both components receive `labels?: UIStrings`, default to `strings.en`, and render inside `AuthLayout`. Use this complete structure for `LoginScreen` while preserving its existing submit function:

```tsx
return (
  <AuthLayout labels={labels}>
    <Card className="w-full max-w-md shadow-lg shadow-slate-200/60">
      <CardHeader>
        <CardTitle>{labels.administratorLogin}</CardTitle>
        <CardDescription>{labels.loginDescription}</CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  </AuthLayout>
);
```

Use the same Card structure in `InitScreen`, with IDs `init-username`, `init-password`, and `init-confirm-password`, and replace hard-coded validation text with `labels.usernameRequired`, `labels.passwordTooShort`, and `labels.passwordMismatch`. Its submit button label is `labels.createAdministrator`.

- [ ] **Step 6: Pass resolved labels from App and update the App test**

Change the auth branches in `web/src/App.tsx` to:

```tsx
{state === "init" && <InitScreen labels={t} onInitialized={() => setState("ready")} />}
{state === "login" && <LoginScreen labels={t} onLoggedIn={() => setState("ready")} />}
```

In `web/src/App.test.tsx`, add API mocks required by `DualPane` and assert Chinese auth copy before readiness:

```tsx
it("uses the selected language on the login screen", async () => {
  vi.mocked(api.initStatus).mockResolvedValue({ needsInitialization: false });
  vi.mocked(api.me).mockRejectedValue(new Error("unauthorized"));
  render(<App />);

  await userEvent.selectOptions(await screen.findByLabelText("Language"), "zh-CN");
  expect(screen.getByRole("heading", { name: "管理员登录" })).toBeInTheDocument();
});
```

Retain the existing top-bar language `<select>` unchanged in this task so the `Language` accessible name remains present. Task 4 replaces it with the shared shadcn language control after the ready-state shell exists.

- [ ] **Step 7: Run auth and App tests**

Run:

```bash
npm --prefix web test -- --run src/components/AuthLayout.test.tsx src/components/LoginScreen.test.tsx src/components/InitScreen.test.tsx src/App.test.tsx
```

Expected: PASS, including existing credential submission and validation tests.

- [ ] **Step 8: Commit the auth redesign**

```bash
git add web/src/components/AuthLayout.tsx web/src/components/AuthLayout.test.tsx web/src/components/LoginScreen.tsx web/src/components/LoginScreen.test.tsx web/src/components/InitScreen.tsx web/src/components/InitScreen.test.tsx web/src/components/ErrorBanner.tsx web/src/App.tsx web/src/App.test.tsx web/src/i18n.ts
git commit -m "feat: redesign authentication screens"
```

### Task 3: Redesign the Compact File Pane

**Files:**
- Create: `web/src/components/FileIcon.tsx`
- Create: `web/src/components/FileIcon.test.tsx`
- Create: `web/src/components/PaneStatusBar.tsx`
- Create: `web/src/components/PaneStatusBar.test.tsx`
- Modify: `web/src/components/FilePane.tsx`
- Modify: `web/src/components/FilePane.test.tsx`
- Modify: `web/src/i18n.ts`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write failing tests for file icons and pane status**

Create `web/src/components/FileIcon.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FileIcon } from "./FileIcon";

it("uses distinct hidden icons for folders and files", () => {
  const { rerender } = render(<FileIcon name="photos" type="directory" />);
  expect(screen.getByTestId("file-icon-directory")).toHaveAttribute("aria-hidden", "true");

  rerender(<FileIcon name="notes.txt" type="file" />);
  expect(screen.getByTestId("file-icon-file")).toHaveAttribute("aria-hidden", "true");
});
```

Create `web/src/components/PaneStatusBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { strings } from "../i18n";
import { PaneStatusBar } from "./PaneStatusBar";

it("shows selected count, selected bytes, and visible count", () => {
  render(<PaneStatusBar selectedCount={2} selectedBytes={1536} visibleCount={18} labels={strings.en} />);

  expect(screen.getByText("2 selected")).toBeInTheDocument();
  expect(screen.getByText("1.5 KB")).toBeInTheDocument();
  expect(screen.getByText("18 items")).toBeInTheDocument();
});
```

Append to `web/src/components/FilePane.test.tsx`:

```tsx
it("renders compact rows and a status footer", () => {
  renderPane({
    entries: [entry("a.txt", "file", 1024), entry("b.txt", "file", 512)],
    selectedPaths: new Set(["a.txt", "b.txt"]),
    isActive: true,
  });

  expect(screen.getByRole("region", { name: "Left pane" })).toHaveAttribute("data-active", "true");
  expect(screen.getAllByRole("row")[1]).toHaveAttribute("data-density", "compact");
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  expect(screen.getByText("1.5 KB")).toBeInTheDocument();
  expect(screen.getByText("2 items")).toBeInTheDocument();
});

it("keeps the active state distinguishable without relying only on color", () => {
  renderPane({ isActive: true });

  expect(screen.getByRole("region", { name: "Left pane" })).toHaveAttribute("aria-current", "true");
});

it("renders loading, empty, and browse-error states", () => {
  const { rerender } = renderPane({ entries: [], loading: true });
  expect(screen.getByTestId("pane-loading")).toBeInTheDocument();

  rerender(renderPaneElement({ entries: [], loading: false, error: null }));
  expect(screen.getByText("This directory is empty")).toBeInTheDocument();

  rerender(renderPaneElement({ entries: [], loading: false, error: "permission denied" }));
  expect(screen.getByRole("alert")).toHaveTextContent("permission denied");
});
```

Replace the existing `renderPane` helper with these helpers so `rerender` receives JSX rather than a second render result:

```tsx
function renderPaneElement(overrides: Partial<Parameters<typeof FilePane>[0]> = {}) {
  return <FilePane {...paneProps(overrides)} />;
}

function paneProps(overrides: Partial<Parameters<typeof FilePane>[0]> = {}) {
  return {
    title: "Left pane",
    roots,
    selectedRootId: "data",
    currentPath: ".",
    entries: [entry("file.txt")],
    selectedPaths: new Set<string>(),
    onRootChange: vi.fn(),
    onPathChange: vi.fn(),
    onToggleSelection: vi.fn(),
    onSelectAll: vi.fn(),
    onSelectPaths: vi.fn(),
    onRefresh: vi.fn(),
    onActivate: vi.fn(),
    loading: false,
    error: null,
    ...overrides,
  };
}

function renderPane(overrides: Partial<Parameters<typeof FilePane>[0]> = {}) {
  return render(renderPaneElement(overrides));
}
```

- [ ] **Step 2: Run the new pane tests and verify they fail**

Run:

```bash
npm --prefix web test -- --run src/components/FileIcon.test.tsx src/components/PaneStatusBar.test.tsx src/components/FilePane.test.tsx
```

Expected: FAIL because `FileIcon`, `PaneStatusBar`, compact row metadata, and status copy do not exist.

- [ ] **Step 3: Add pane status strings**

Add these fields to `UIStrings`:

```ts
selectedItems(count: number): string;
visibleItems(count: number): string;
noSelection: string;
emptyDirectory: string;
browseFailed: string;
```

Add to `strings.en`:

```ts
selectedItems: (count) => `${count} selected`,
visibleItems: (count) => `${count} ${count === 1 ? "item" : "items"}`,
noSelection: "No selection",
emptyDirectory: "This directory is empty",
browseFailed: "Unable to load this directory",
```

Add to `strings["zh-CN"]`:

```ts
selectedItems: (count) => `已选择 ${count} 项`,
visibleItems: (count) => `共 ${count} 项`,
noSelection: "未选择",
emptyDirectory: "当前文件夹为空",
browseFailed: "无法加载当前文件夹",
```

- [ ] **Step 4: Implement FileIcon and PaneStatusBar**

Create `web/src/components/FileIcon.tsx`:

```tsx
import { File, FileArchive, FileImage, FileText, FileVideo, FolderClosed, Link } from "lucide-react";
import type { Entry } from "../api/types";

export function FileIcon({ name, type }: Pick<Entry, "name" | "type">) {
  const Icon = iconForEntry(name, type);
  return <Icon aria-hidden="true" data-testid={`file-icon-${type === "directory" ? "directory" : "file"}`} className="size-3.5 shrink-0" />;
}

function iconForEntry(name: string, type: Entry["type"]) {
  if (type === "directory") return FolderClosed;
  if (type === "symlink") return Link;
  const extension = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(extension ?? "")) return FileImage;
  if (["mp4", "webm", "mov", "mkv"].includes(extension ?? "")) return FileVideo;
  if (["zip", "tar", "gz", "7z", "rar"].includes(extension ?? "")) return FileArchive;
  if (["txt", "md", "json", "yaml", "yml", "toml", "csv"].includes(extension ?? "")) return FileText;
  return File;
}
```

Create `web/src/components/PaneStatusBar.tsx`:

```tsx
import type { UIStrings } from "../i18n";

export function PaneStatusBar({
  selectedCount,
  selectedBytes,
  visibleCount,
  labels,
}: {
  selectedCount: number;
  selectedBytes: number;
  visibleCount: number;
  labels: UIStrings;
}) {
  return (
    <footer className="flex h-7 items-center gap-3 border-t bg-slate-50 px-2 text-[11px] text-slate-500">
      <span className="font-medium text-slate-700">{selectedCount ? labels.selectedItems(selectedCount) : labels.noSelection}</span>
      {selectedCount ? <span>{formatBytes(selectedBytes)}</span> : null}
      <span className="ml-auto">{labels.visibleItems(visibleCount)}</span>
    </footer>
  );
}

export function formatBytes(size: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;
  while (Math.abs(value) >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}
```

- [ ] **Step 5: Apply the compact shadcn styling to FilePane**

Add these imports to `web/src/components/FilePane.tsx`:

```tsx
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "./ErrorBanner";
import { FileIcon } from "./FileIcon";
import { PaneStatusBar, formatBytes } from "./PaneStatusBar";
```

Add these props to `FilePaneProps` and defaults in the component parameters:

```tsx
loading?: boolean;
error?: string | null;
```

```tsx
loading = false,
error = null,
```

After `visibleEntries`, derive selected bytes:

```tsx
const selectedEntries = visibleEntries.filter((entry) => selectedPaths.has(entry.relativePath));
const selectedBytes = selectedEntries.reduce((total, entry) => total + entry.size, 0);
```

Replace the opening `<section>` tag with:

```tsx
<section
  className="file-pane"
  aria-label={title}
  aria-current={isActive ? "true" : undefined}
  data-active={isActive ? "true" : "false"}
  onClick={onActivate}
>
```

Insert the status footer immediately before the closing `</section>`:

```tsx
  <PaneStatusBar
    selectedCount={selectedEntries.length}
    selectedBytes={selectedBytes}
    visibleCount={visibleEntries.length}
    labels={labels}
  />
```

Use shadcn controls in the pane header:

```tsx
<Input
  aria-label={labels.pathLabel(title)}
  className="h-7 min-w-0 text-xs"
  value={pathDraft}
  onChange={(event) => {
    setPathDraft(event.target.value);
    setHighlightedSuggestion(-1);
  }}
  onKeyDown={handlePathKeyDown}
  onFocus={() => setHighlightedSuggestion(-1)}
/>
<Button type="button" variant="outline" size="icon-sm" aria-label={labels.refreshLabel(title)} onClick={onRefresh}>
  <RefreshCw />
</Button>
```

Keep the existing single-root marker and native root `<select>` behavior in this task, but give both `h-7 rounded-md border bg-slate-50 px-2 text-xs` styling. A native select is retained because roots are a simple bounded list and existing keyboard behavior is already correct.

Replace table checkboxes with the shadcn Checkbox API:

```tsx
<Checkbox
  aria-label={labels.selectAllVisible}
  checked={allVisibleSelected}
  onCheckedChange={(checked) => onSelectAll(checked === true)}
/>
```

```tsx
<Checkbox
  aria-label={labels.selectEntry(entry.name)}
  checked={selectedPaths.has(entry.relativePath)}
  onCheckedChange={() => onToggleSelection(entry.relativePath)}
/>
```

Give every body row `data-density="compact"`, and replace the name cell contents with:

```tsx
<span className="flex min-w-0 items-center gap-1.5">
  <FileIcon name={entry.name} type={entry.type} />
  <span className="truncate font-medium text-slate-700">{entry.name}</span>
  {entry.isSymlink && entry.symlinkTarget ? (
    <small className="truncate text-slate-400">{" -> "}{entry.symlinkTarget}</small>
  ) : null}
</span>
```

Replace the text sort markers with icons:

```tsx
{active ? direction === "asc" ? <ChevronUp aria-hidden="true" className="size-3" /> : <ChevronDown aria-hidden="true" className="size-3" /> : null}
```

Replace calls to the old `formatSize` helper with `formatBytes`, then remove `formatSize` from the bottom of `FilePane.tsx`.

Inside `.file-list`, wrap the current complete `<table>` element with this conditional prefix:

```tsx
{loading ? (
  <div data-testid="pane-loading" className="grid gap-1 p-2">
    {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-7" />)}
  </div>
) : error ? (
  <div className="p-3"><ErrorBanner message={error} /></div>
) : visibleEntries.length === 0 ? (
  <div className="grid h-full place-items-center text-xs text-slate-500">{labels.emptyDirectory}</div>
) : (
```

After the current `</table>`, close the conditional with:

```tsx
)}
```

- [ ] **Step 6: Add only the custom CSS required by pane mechanics**

Append these structural rules to `web/src/styles.css`; use Tailwind classes for ordinary colors and spacing:

```css
.file-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 39px 29px minmax(0, 1fr) 28px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
}

.file-pane[data-active="true"] {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary) 16%, transparent);
}

.file-list {
  position: relative;
  min-height: 0;
  overflow: auto;
}

.file-table {
  width: var(--file-table-width);
  min-width: var(--file-table-width);
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}

.file-table th,
.file-table td {
  position: relative;
  height: 28px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-table thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  height: 29px;
  background: var(--muted);
}

.drag-selection-box {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  border: 1px solid var(--primary);
  background: color-mix(in oklab, var(--primary) 16%, transparent);
}
```

Retain the existing column CSS variables, resize handles, path suggestion positioning, and pane-divider mechanics. Delete old color declarations that conflict with shadcn tokens.

- [ ] **Step 7: Run pane tests and commit**

Run:

```bash
npm --prefix web test -- --run src/components/FileIcon.test.tsx src/components/PaneStatusBar.test.tsx src/components/FilePane.test.tsx
```

Expected: PASS, including existing path, sorting, column-resize, and drag-selection tests.

Commit:

```bash
git add web/src/components/FileIcon.tsx web/src/components/FileIcon.test.tsx web/src/components/PaneStatusBar.tsx web/src/components/PaneStatusBar.test.tsx web/src/components/FilePane.tsx web/src/components/FilePane.test.tsx web/src/i18n.ts web/src/styles.css
git commit -m "feat: redesign compact file panes"
```

### Task 4: Add the Desktop App Shell and Direction-Aware Toolbar

**Files:**
- Create: `web/src/components/AppShell.tsx`
- Create: `web/src/components/AppShell.test.tsx`
- Create: `web/src/components/ActionToolbar.tsx`
- Create: `web/src/components/ActionToolbar.test.tsx`
- Create: `web/src/components/LanguageSelect.tsx`
- Modify: `web/src/components/DualPane.tsx`
- Modify: `web/src/components/DualPane.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`
- Modify: `web/src/i18n.ts`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write failing tests for shell structure and operation direction**

Create `web/src/components/ActionToolbar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { ActionToolbar } from "./ActionToolbar";

it("labels transfer actions with the opposite pane", async () => {
  const onOperation = vi.fn();
  render(
    <ActionToolbar
      activePane="left"
      selectedCount={2}
      onOperation={onOperation}
      onMkdir={vi.fn()}
      onRename={vi.fn()}
      onPowerRename={vi.fn()}
      labels={strings.en}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Copy to right pane" }));
  expect(onOperation).toHaveBeenCalledWith("copy");
  expect(screen.getByRole("button", { name: "Move to right pane" })).toBeEnabled();
});

it("keeps rename limited to a single selection", () => {
  const { rerender } = render(
    <ActionToolbar
      activePane="left"
      selectedCount={0}
      onOperation={vi.fn()}
      onMkdir={vi.fn()}
      onRename={vi.fn()}
      onPowerRename={vi.fn()}
      labels={strings.en}
    />,
  );
  expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();

  rerender(
    <ActionToolbar
      activePane="left"
      selectedCount={1}
      onOperation={vi.fn()}
      onMkdir={vi.fn()}
      onRename={vi.fn()}
      onPowerRename={vi.fn()}
      labels={strings.en}
    />,
  );
  expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
});
```

Create `web/src/components/AppShell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { AppShell } from "./AppShell";

it("renders a desktop rail and opens jobs from either entry", async () => {
  const onJobsOpen = vi.fn();
  render(
    <AppShell labels={strings.en} activeJobCount={2} onJobsOpen={onJobsOpen} languageControl={<span>language</span>}>
      <p>workspace</p>
    </AppShell>,
  );

  expect(screen.getByRole("navigation", { name: "Workspace navigation" })).toBeInTheDocument();
  expect(screen.getByText("workspace")).toBeInTheDocument();
  expect(screen.getByText("2 active jobs")).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "Jobs" })[0]);
  expect(onJobsOpen).toHaveBeenCalled();
});
```

Append to `web/src/components/DualPane.test.tsx`:

```tsx
it("updates transfer labels when the active pane changes", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "a.txt", relativePath: "a.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  render(<DualPane />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(within(leftPane).getByLabelText("Select a.txt"));
  expect(screen.getByRole("button", { name: "Copy to right pane" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("region", { name: "Right pane" }));
  expect(screen.getByRole("button", { name: "Copy to left pane" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the shell and toolbar tests and verify they fail**

Run:

```bash
npm --prefix web test -- --run src/components/ActionToolbar.test.tsx src/components/AppShell.test.tsx src/components/DualPane.test.tsx
```

Expected: FAIL because the new components and destination-aware labels do not exist.

- [ ] **Step 3: Add shell and toolbar strings**

Add these fields to `UIStrings`:

```ts
workspace: string;
workspaceNavigation: string;
files: string;
activeJobs(count: number): string;
copyToPane(pane: string): string;
moveToPane(pane: string): string;
selectionSummary(count: number): string;
```

Add to `strings.en`:

```ts
workspace: "Dual-pane file workspace",
workspaceNavigation: "Workspace navigation",
files: "Files",
activeJobs: (count) => `${count} active ${count === 1 ? "job" : "jobs"}`,
copyToPane: (pane) => `Copy to ${pane.toLowerCase()}`,
moveToPane: (pane) => `Move to ${pane.toLowerCase()}`,
selectionSummary: (count) => `${count} selected`,
```

Add to `strings["zh-CN"]`:

```ts
workspace: "双栏文件工作台",
workspaceNavigation: "工作区导航",
files: "文件",
activeJobs: (count) => `${count} 个任务运行中`,
copyToPane: (pane) => `复制到${pane}`,
moveToPane: (pane) => `移动到${pane}`,
selectionSummary: (count) => `已选择 ${count} 项`,
```

- [ ] **Step 4: Implement LanguageSelect, ActionToolbar, and AppShell**

Create `web/src/components/LanguageSelect.tsx`:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LanguageMode, UIStrings } from "../i18n";

export function LanguageSelect({
  value,
  onChange,
  labels,
}: {
  value: LanguageMode;
  onChange(value: LanguageMode): void;
  labels: UIStrings;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as LanguageMode)}>
      <SelectTrigger aria-label="Language" className="h-7 w-[118px] bg-slate-50 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">{labels.languageAuto}</SelectItem>
        <SelectItem value="en">{labels.languageEnglish}</SelectItem>
        <SelectItem value="zh-CN">{labels.languageChinese}</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

Create `web/src/components/ActionToolbar.tsx`:

```tsx
import { Copy, FolderPlus, Link, Link2, MoveRight, Pencil, ScanText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { OpsRequest } from "../api/types";
import type { UIStrings } from "../i18n";

export type PaneSide = "left" | "right";

type Props = {
  activePane: PaneSide;
  selectedCount: number;
  labels: UIStrings;
  onOperation(type: OpsRequest["type"]): void;
  onMkdir(): void;
  onRename(): void;
  onPowerRename(): void;
};

export function ActionToolbar({ activePane, selectedCount, labels, onOperation, onMkdir, onRename, onPowerRename }: Props) {
  const destination = activePane === "left" ? labels.rightPane : labels.leftPane;
  const hasSelection = selectedCount > 0;

  return (
    <nav aria-label="File actions" className="flex h-[42px] items-center gap-1.5 border-b bg-slate-50 px-3">
      <Button size="sm" aria-label={labels.copyToPane(destination)} onClick={() => onOperation("copy")} disabled={!hasSelection}>
        <Copy /><span className="action-label">{labels.copyToPane(destination)}</span>
      </Button>
      <Button size="sm" variant="outline" aria-label={labels.moveToPane(destination)} onClick={() => onOperation("move")} disabled={!hasSelection}>
        <MoveRight /><span className="action-label">{labels.moveToPane(destination)}</span>
      </Button>
      <Button size="sm" variant="outline" aria-label={labels.symlink} onClick={() => onOperation("symlink")} disabled={!hasSelection}>
        <Link /><span className="action-label">{labels.symlink}</span>
      </Button>
      <Button size="sm" variant="outline" aria-label={labels.hardlink} onClick={() => onOperation("hardlink")} disabled={!hasSelection}>
        <Link2 /><span className="action-label">{labels.hardlink}</span>
      </Button>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Button size="sm" variant="outline" aria-label={labels.mkdir} onClick={onMkdir}>
        <FolderPlus /><span className="action-label">{labels.mkdir}</span>
      </Button>
      <Button size="sm" variant="outline" aria-label={labels.rename} onClick={onRename} disabled={selectedCount !== 1}>
        <Pencil /><span className="action-label">{labels.rename}</span>
      </Button>
      <Button size="sm" variant="outline" aria-label={labels.powerRename} onClick={onPowerRename} disabled={!hasSelection}>
        <ScanText /><span className="action-label">{labels.powerRename}</span>
      </Button>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Button size="sm" variant="ghost" aria-label={labels.delete} className="text-destructive hover:text-destructive" onClick={() => onOperation("delete")} disabled={!hasSelection}>
        <Trash2 /><span className="action-label">{labels.delete}</span>
      </Button>
      <span className="ml-auto text-xs text-slate-500">{labels.selectionSummary(selectedCount)}</span>
    </nav>
  );
}
```

Create `web/src/components/AppShell.tsx`:

```tsx
import type { ReactNode } from "react";
import { BriefcaseBusiness, Files, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
    <TooltipProvider>
      <main className="grid h-screen min-w-[1024px] grid-cols-[54px_minmax(0,1fr)] overflow-hidden bg-slate-100">
        <nav aria-label={labels.workspaceNavigation} className="flex flex-col items-center border-r bg-white px-2 py-2.5">
          <div className="mb-4 grid size-8 place-items-center rounded-lg bg-blue-600 font-bold text-white shadow-sm">F</div>
          <Tooltip>
            <TooltipTrigger asChild><Button aria-current="page" aria-label={labels.files} size="icon" variant="secondary"><Files /></Button></TooltipTrigger>
            <TooltipContent side="right">{labels.files}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild><Button aria-label={labels.jobs} size="icon" variant="ghost" onClick={onJobsOpen}><ListChecks /></Button></TooltipTrigger>
            <TooltipContent side="right">{labels.jobs}</TooltipContent>
          </Tooltip>
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
    </TooltipProvider>
  );
}
```

- [ ] **Step 5: Integrate the shell and toolbar into DualPane**

Change the `DualPane` signature and add shell state:

```tsx
import type { LanguageMode } from "../i18n";
import { ActionToolbar } from "./ActionToolbar";
import { AppShell } from "./AppShell";
import { LanguageSelect } from "./LanguageSelect";

export function DualPane({
  labels = strings.en,
  languageMode = "auto",
  onLanguageModeChange = () => undefined,
}: {
  labels?: UIStrings;
  languageMode?: LanguageMode;
  onLanguageModeChange?(mode: LanguageMode): void;
}) {
  const [activeJobCount, setActiveJobCount] = useState(0);
  // retain all existing state below
```

Replace the existing toolbar and workspace wrapper with:

```tsx
<AppShell
  labels={labels}
  activeJobCount={activeJobCount}
  onJobsOpen={() => setJobsOpen(true)}
  languageControl={<LanguageSelect value={languageMode} onChange={onLanguageModeChange} labels={labels} />}
>
  <div className="grid h-full min-h-0 grid-rows-[42px_minmax(0,1fr)] overflow-hidden">
    <ActionToolbar
      activePane={activePane}
      selectedCount={activeSelection().length}
      labels={labels}
      onOperation={openOperation}
      onMkdir={openMkdir}
      onRename={() => setSingleRenameOpen(true)}
      onPowerRename={() => setPowerRenameOpen(true)}
    />
    <section
      className="workspace"
      data-testid="workspace"
      data-active-pane={activePane}
      style={workspaceStyle(leftPanePercent)}
    >
      <FilePane title={labels.leftPane} labels={labels} {...paneProps("left", left)} />
      <div
        className="pane-divider"
        role="separator"
        aria-label={labels.resizePanes}
        aria-orientation="vertical"
        onMouseDown={startPaneResize}
      />
      <FilePane title={labels.rightPane} labels={labels} {...paneProps("right", right)} />
    </section>
  </div>
</AppShell>
```

Keep all existing dialogs and the current `JobsPanel` as siblings after `AppShell` until Task 5 replaces it. Remove the old `.workspace-toolbar` markup entirely.

Extend `PaneState` with request state:

```ts
loading: boolean;
error: string | null;
```

Initialize both panes with `loading: false` and `error: null`, pass both values from `paneProps`, and replace `loadPane` with:

```tsx
async function loadPane(which: PaneKey, rootId: string, path: string) {
  updatePane(which, (pane) => ({ ...pane, loading: true, error: null }));
  try {
    const entries = await api.browse(rootId, path);
    updatePane(which, (pane) => ({
      ...pane,
      entries,
      selected: visibleSelection(pane.selected, entries),
      visibleOrder: entries.map((entry) => entry.relativePath),
      loading: false,
      error: null,
    }));
  } catch (err) {
    updatePane(which, (pane) => ({
      ...pane,
      entries: [],
      selected: new Set(),
      visibleOrder: [],
      loading: false,
      error: err instanceof Error ? err.message : labels.browseFailed,
    }));
  }
}
```

Append to `DualPane.test.tsx`:

```tsx
it("shows browse failures inside the affected panes", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockRejectedValue(new Error("permission denied"));
  render(<DualPane />);

  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("permission denied");
});
```

The `setActiveJobCount` state is intentionally unused until Task 5; pass it to the new jobs component there. If TypeScript flags the setter before Task 5, declare only `const [activeJobCount] = useState(0)` in this commit and introduce the setter in Task 5.

- [ ] **Step 6: Move ready-state language control into the shell**

Restructure `web/src/App.tsx` so ready state returns directly:

```tsx
if (state === "ready") {
  return (
    <DualPane
      labels={t}
      languageMode={languageMode}
      onLanguageModeChange={setLanguageMode}
    />
  );
}
```

For loading, initialization, and login, keep a positioned `LanguageSelect` above the existing content:

```tsx
return (
  <div className="relative h-screen min-w-[1024px] overflow-hidden">
    <div className="absolute right-4 top-4 z-20">
      <LanguageSelect value={languageMode} onChange={setLanguageMode} labels={t} />
    </div>
    {state === "loading" ? (
      <main className="grid h-full place-items-center bg-slate-50 text-sm text-slate-500">{t.loadingWorkspace}</main>
    ) : null}
    {state === "init" ? <InitScreen labels={t} onInitialized={() => setState("ready")} /> : null}
    {state === "login" ? <LoginScreen labels={t} onLoggedIn={() => setState("ready")} /> : null}
  </div>
);
```

Update the language interactions in `web/src/App.test.tsx` to Radix Select semantics:

```tsx
await userEvent.click(await screen.findByRole("combobox", { name: "Language" }));
await userEvent.click(screen.getByRole("option", { name: "简体中文" }));
```

Update the shell test to wait for boot completion:

```tsx
it("renders the FileButler app shell", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: "FileButler" })).toBeInTheDocument();
});
```

- [ ] **Step 7: Add desktop workspace mechanics and run tests**

Replace the old workspace layout rules in `web/src/styles.css` with:

```css
.workspace {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 8px minmax(0, 1fr);
  gap: 0;
  padding: 10px;
  overflow: hidden;
  background: var(--muted);
}

.pane-divider {
  position: relative;
  cursor: col-resize;
  user-select: none;
}

.pane-divider::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 38px;
  border-radius: 999px;
  background: var(--border);
  transform: translate(-50%, -50%);
}

.pane-divider:hover::after,
.pane-divider:active::after {
  background: var(--primary);
}

@media (max-width: 1180px) {
  .action-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
}
```

Run:

```bash
npm --prefix web test -- --run src/components/ActionToolbar.test.tsx src/components/AppShell.test.tsx src/components/DualPane.test.tsx src/App.test.tsx
npm --prefix web run build
```

Expected: PASS. The build must not report unused shell props or state.

Commit:

```bash
git add web/src/components/AppShell.tsx web/src/components/AppShell.test.tsx web/src/components/ActionToolbar.tsx web/src/components/ActionToolbar.test.tsx web/src/components/LanguageSelect.tsx web/src/components/DualPane.tsx web/src/components/DualPane.test.tsx web/src/App.tsx web/src/App.test.tsx web/src/i18n.ts web/src/styles.css
git commit -m "feat: add desktop file workbench shell"
```

### Task 5: Replace JobsPanel with a Polling Jobs Sheet

**Files:**
- Create: `web/src/components/JobsSheet.tsx`
- Create: `web/src/components/JobsSheet.test.tsx`
- Delete: `web/src/components/JobsPanel.tsx`
- Delete: `web/src/components/JobsPanel.test.tsx`
- Modify: `web/src/components/DualPane.tsx`
- Modify: `web/src/components/DualPane.test.tsx`
- Modify: `web/src/App.test.tsx`
- Modify: `web/src/i18n.ts`

- [ ] **Step 1: Write failing tests for jobs progress, count, and cancellation**

Create `web/src/components/JobsSheet.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { JobsSheet } from "./JobsSheet";

vi.mock("../api/client", () => ({
  api: { jobs: vi.fn(), job: vi.fn(), cancelJob: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.jobs).mockReset();
  vi.mocked(api.job).mockReset();
  vi.mocked(api.cancelJob).mockReset();
});

it("reports active jobs and renders progress in the open sheet", async () => {
  const onActiveCountChange = vi.fn();
  vi.mocked(api.jobs).mockResolvedValue([
    { id: "job_1", type: "copy", status: "running", progressTotal: 4, progressDone: 2, errorMessage: "" },
  ]);
  vi.mocked(api.job).mockResolvedValue({
    id: "job_1", type: "copy", status: "running", progressTotal: 4, progressDone: 2, errorMessage: "",
    items: [{ sourcePath: "a.txt", destPath: "archive/a.txt", conflict: false }],
  });

  render(<JobsSheet open onOpenChange={vi.fn()} onActiveCountChange={onActiveCountChange} />);

  expect(await screen.findByRole("dialog", { name: "Jobs" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "copy progress" })).toHaveAttribute("aria-valuenow", "50");
  expect(await screen.findByText("a.txt")).toBeInTheDocument();
  await waitFor(() => expect(onActiveCountChange).toHaveBeenCalledWith(1));
});

it("cancels a running selected job", async () => {
  vi.mocked(api.jobs).mockResolvedValue([
    { id: "job_1", type: "copy", status: "running", progressTotal: 2, progressDone: 1, errorMessage: "" },
  ]);
  vi.mocked(api.job).mockResolvedValue({
    id: "job_1", type: "copy", status: "running", progressTotal: 2, progressDone: 1, errorMessage: "", items: [],
  });
  vi.mocked(api.cancelJob).mockResolvedValue({ id: "job_1" });

  render(<JobsSheet open onOpenChange={vi.fn()} onActiveCountChange={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(api.cancelJob).toHaveBeenCalledWith("job_1");
});
```

Append to `web/src/components/DualPane.test.tsx`:

```tsx
it("opens the jobs sheet from the workbench", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([]);
  vi.mocked(api.jobs).mockResolvedValue([]);
  render(<DualPane />);

  await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(screen.getAllByRole("button", { name: "Jobs" })[0]);
  expect(screen.getByRole("dialog", { name: "Jobs" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the new jobs tests and verify they fail**

Run:

```bash
npm --prefix web test -- --run src/components/JobsSheet.test.tsx src/components/DualPane.test.tsx
```

Expected: FAIL because `JobsSheet` does not exist and the existing panel is not a Sheet.

- [ ] **Step 3: Add jobs-sheet copy**

Add these fields to `UIStrings`:

```ts
allJobs: string;
runningJobs: string;
completedJobs: string;
emptyJobs: string;
jobProgress(type: string): string;
```

Add to `strings.en`:

```ts
allJobs: "All",
runningJobs: "Running",
completedJobs: "Completed",
emptyJobs: "No background jobs yet",
jobProgress: (type) => `${strings.en.operationType(type)} progress`,
```

Add to `strings["zh-CN"]`:

```ts
allJobs: "全部",
runningJobs: "进行中",
completedJobs: "已完成",
emptyJobs: "暂无后台任务",
jobProgress: (type) => `${strings["zh-CN"].operationType(type)}进度`,
```

- [ ] **Step 4: Implement JobsSheet with list polling and detail polling**

Create `web/src/components/JobsSheet.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "../api/client";
import type { Job, PlanItem } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";

type JobDetail = Job & { items: PlanItem[] };
type Filter = "all" | "running" | "completed";
const activeStatuses = new Set(["pending", "running", "cancel_requested"]);

export function JobsSheet({
  open,
  onOpenChange,
  onActiveCountChange,
  labels = strings.en,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onActiveCountChange(count: number): void;
  labels?: UIStrings;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let active = true;
    async function load() {
      const list = await api.jobs();
      if (!active) return;
      setJobs(list);
      setSelectedID((current) => current && list.some((job) => job.id === current) ? current : list[0]?.id ?? null);
      onActiveCountChange(list.filter((job) => activeStatuses.has(job.status)).length);
    }
    void load();
    const interval = window.setInterval(load, 2000);
    return () => { active = false; window.clearInterval(interval); };
  }, [onActiveCountChange]);

  useEffect(() => {
    if (!open || !selectedID) return;
    let active = true;
    async function loadDetail() {
      const next = await api.job(selectedID);
      if (active) setDetail(next);
    }
    void loadDetail();
    const interval = window.setInterval(loadDetail, 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [open, selectedID]);

  const filteredJobs = useMemo(() => jobs.filter((job) => {
    if (filter === "running") return activeStatuses.has(job.status);
    if (filter === "completed") return !activeStatuses.has(job.status);
    return true;
  }), [filter, jobs]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-label={labels.jobs} className="w-[420px] sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>{labels.jobs}</SheetTitle>
          <SheetDescription>{labels.activeJobs(jobs.filter((job) => activeStatuses.has(job.status)).length)}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex gap-1 rounded-md bg-slate-100 p-1">
          {(["all", "running", "completed"] as const).map((value) => (
            <Button key={value} size="sm" variant={filter === value ? "secondary" : "ghost"} className="flex-1" onClick={() => setFilter(value)}>
              {value === "all" ? labels.allJobs : value === "running" ? labels.runningJobs : labels.completedJobs}
            </Button>
          ))}
        </div>
        <div className="mt-4 grid gap-2">
          {filteredJobs.length ? filteredJobs.map((job) => {
            const percent = job.progressTotal ? Math.round((job.progressDone / job.progressTotal) * 100) : 0;
            return (
              <button key={job.id} type="button" className="rounded-lg border bg-white p-3 text-left" onClick={() => setSelectedID(job.id)}>
                <div className="flex items-center justify-between text-xs font-semibold"><span>{labels.operationType(job.type)}</span><span>{labels.jobStatus(job.status)}</span></div>
                <Progress aria-label={labels.jobProgress(job.type)} value={percent} className="mt-2" />
                <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>{job.progressDone}/{job.progressTotal}</span><span>{percent}%</span></div>
              </button>
            );
          }) : <p className="py-10 text-center text-sm text-slate-500">{labels.emptyJobs}</p>}
        </div>
        {detail ? (
          <section className="mt-5 border-t pt-4">
            <h3 className="text-sm font-semibold">{labels.operationType(detail.type)}</h3>
            <p className="mt-1 text-xs text-slate-500">{labels.jobStatus(detail.status)} · {detail.progressDone}/{detail.progressTotal}</p>
            {detail.items.length ? (
              <ul className="mt-3 grid gap-1 text-xs text-slate-600">
                {detail.items.map((item, index) => (
                  <li key={`${item.sourcePath}-${item.destPath ?? item.targetPath ?? index}`} className="rounded border bg-slate-50 px-2 py-1.5">
                    <span className="font-medium text-slate-800">{item.sourcePath}</span>
                    {item.destPath ?? item.targetPath ? <span className="ml-2 text-slate-400">→ {item.destPath ?? item.targetPath}</span> : null}
                    {item.conflict ? <span className="ml-2 text-destructive">{item.errorText || item.errorCode}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {activeStatuses.has(detail.status) ? <Button className="mt-3" variant="outline" size="sm" onClick={() => void api.cancelJob(detail.id)}>{labels.cancel}</Button> : null}
          </section>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Wire JobsSheet into DualPane and remove JobsPanel**

Replace the `JobsPanel` import with:

```tsx
import { JobsSheet } from "./JobsSheet";
```

Ensure Task 4's state includes the setter:

```tsx
const [activeJobCount, setActiveJobCount] = useState(0);
```

Replace the final jobs render with:

```tsx
<JobsSheet
  open={jobsOpen}
  onOpenChange={setJobsOpen}
  onActiveCountChange={setActiveJobCount}
  labels={labels}
/>
```

Keep `handleJobCreated` setting `jobsOpen` to `true`; the new Sheet will open immediately after a job is created.

Delete `web/src/components/JobsPanel.tsx` and `web/src/components/JobsPanel.test.tsx` after the new tests pass.

Extend the `api` mock in `web/src/App.test.tsx` with:

```tsx
jobs: vi.fn(),
job: vi.fn(),
cancelJob: vi.fn(),
```

Add this default in its `beforeEach`:

```tsx
vi.mocked(api.jobs).mockResolvedValue([]);
```

- [ ] **Step 6: Run jobs tests and commit**

Run:

```bash
npm --prefix web test -- --run src/components/JobsSheet.test.tsx src/components/DualPane.test.tsx src/App.test.tsx
```

Expected: PASS. The active count callback receives `1`, progress is exposed as 50 percent, cancel calls the existing endpoint, and the Sheet opens from the workbench.

Commit:

```bash
git add web/src/components/JobsSheet.tsx web/src/components/JobsSheet.test.tsx web/src/components/DualPane.tsx web/src/components/DualPane.test.tsx web/src/App.test.tsx web/src/i18n.ts
git rm web/src/components/JobsPanel.tsx web/src/components/JobsPanel.test.tsx
git commit -m "feat: replace jobs panel with jobs sheet"
```

### Task 6: Convert Operation and Utility Dialogs to shadcn/ui

**Files:**
- Modify: `web/src/components/OperationPreview.tsx`
- Modify: `web/src/components/OperationPreview.test.tsx`
- Modify: `web/src/components/MkdirDialog.tsx`
- Create: `web/src/components/MkdirDialog.test.tsx`
- Modify: `web/src/components/SingleRenameDialog.tsx`
- Modify: `web/src/components/SingleRenameDialog.test.tsx`
- Modify: `web/src/components/MediaPreview.tsx`
- Create: `web/src/components/MediaPreview.test.tsx`
- Modify: `web/src/components/DualPane.tsx`
- Modify: `web/src/components/DualPane.test.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/i18n.ts`

- [ ] **Step 1: Write failing tests for dialog semantics and destructive confirmation**

Append to `web/src/components/OperationPreview.test.tsx`:

```tsx
it("uses a destructive item-count label for delete", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [
      { sourcePath: "a.txt", conflict: false },
      { sourcePath: "b.txt", conflict: false },
    ],
  });
  render(
    <OperationPreview
      request={{ type: "delete", sourceRoot: "root", sources: ["a.txt", "b.txt"] }}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  const confirm = await screen.findByRole("button", { name: "Delete 2 items" });
  expect(confirm).toHaveAttribute("data-variant", "destructive");
});
```

Create `web/src/components/MkdirDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MkdirDialog } from "./MkdirDialog";

it("submits a trimmed directory name from an accessible dialog", async () => {
  const onSubmit = vi.fn();
  render(<MkdirDialog onClose={vi.fn()} onSubmit={onSubmit} />);

  const dialog = screen.getByRole("dialog", { name: "Directory name" });
  await userEvent.type(screen.getByLabelText("Directory name"), "  assets  ");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(dialog).toBeInTheDocument();
  expect(onSubmit).toHaveBeenCalledWith("assets");
});
```

Create `web/src/components/MediaPreview.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MediaPreview } from "./MediaPreview";

it("renders image content in a named dialog", () => {
  render(<MediaPreview name="photo.jpg" url="/photo.jpg" kind="image" onClose={vi.fn()} />);
  expect(screen.getByRole("dialog", { name: "Media preview" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "photo.jpg" })).toHaveAttribute("src", "/photo.jpg");
});
```

In `DualPane.test.tsx`, replace `getByRole("region", { name: "Directory name" })` with `getByRole("dialog", { name: "Directory name" })`, and replace every `findByRole("region", { name: "Rename dialog" })` with `findByRole("dialog", { name: "Rename dialog" })`.

- [ ] **Step 2: Run dialog tests and verify they fail**

Run:

```bash
npm --prefix web test -- --run src/components/OperationPreview.test.tsx src/components/MkdirDialog.test.tsx src/components/SingleRenameDialog.test.tsx src/components/MediaPreview.test.tsx src/components/DualPane.test.tsx
```

Expected: FAIL because the old modal markup exposes regions, has no destructive variant metadata, and has no item-count confirmation label.

- [ ] **Step 3: Add operation-dialog copy**

Add these fields to `UIStrings`:

```ts
operationDescription(type: string, count: number): string;
confirmOperation(type: string, count: number): string;
deleteWarning: string;
conflictsFound(count: number): string;
jobCreated: string;
```

Add to `strings.en`:

```ts
operationDescription: (type, count) => `${strings.en.operationType(type)} ${count} ${count === 1 ? "item" : "items"}`,
confirmOperation: (type, count) => type === "delete" ? `Delete ${count} ${count === 1 ? "item" : "items"}` : `Start ${strings.en.operationType(type)}`,
deleteWarning: "Deleted items cannot be restored by FileButler.",
conflictsFound: (count) => `${count} ${count === 1 ? "conflict" : "conflicts"} must be resolved before continuing.`,
jobCreated: "Background job created",
```

Add to `strings["zh-CN"]`:

```ts
operationDescription: (type, count) => `${strings["zh-CN"].operationType(type)} ${count} 项`,
confirmOperation: (type, count) => type === "delete" ? `删除 ${count} 项` : `开始${strings["zh-CN"].operationType(type)}`,
deleteWarning: "FileButler 无法恢复已删除的项目。",
conflictsFound: (count) => `发现 ${count} 个冲突，解决后才能继续。`,
jobCreated: "后台任务已创建",
```

- [ ] **Step 4: Convert OperationPreview to Dialog, Alert, and Table primitives**

Add `const [submitting, setSubmitting] = useState(false);` and replace `confirm` with:

```tsx
async function confirm() {
  setSubmitting(true);
  setError(null);
  try {
    const job = await api.opsCreateJob(request);
    onJobCreated(job.id);
  } catch (err) {
    setError(err instanceof Error ? err.message : labels.jobCreationFailed);
  } finally {
    setSubmitting(false);
  }
}
```

Replace the return block in `web/src/components/OperationPreview.tsx` with:

```tsx
const conflictCount = items.filter((item) => item.conflict).length;
const itemCount = request.type === "mkdir" ? 1 : request.sources.length;
const destructive = request.type === "delete";

return (
  <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent aria-label={labels.operationPreview(request.type)} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{labels.operationPreview(request.type)}</DialogTitle>
        <DialogDescription>{labels.operationDescription(request.type, itemCount)}</DialogDescription>
      </DialogHeader>
      <ErrorBanner message={error} />
      {destructive ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{labels.deleteWarning}</AlertDescription>
        </Alert>
      ) : null}
      {conflictCount ? (
        <Alert>
          <CircleAlert />
          <AlertDescription>{labels.conflictsFound(conflictCount)}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? (
        <div className="grid gap-2">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-7" />)}</div>
      ) : (
        <div className="max-h-[420px] overflow-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>{labels.source}</TableHead><TableHead>{labels.destination}</TableHead><TableHead>{labels.status}</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={`${item.sourcePath}-${item.destPath ?? item.targetPath ?? ""}`}>
                  <TableCell>{displaySource(item, request)}</TableCell>
                  <TableCell>{displayDestination(item, request)}</TableCell>
                  <TableCell className={item.conflict ? "text-destructive" : "text-emerald-700"}>{item.conflict ? item.errorText || item.errorCode : labels.ready}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
        <Button variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={hasConflict || loading || submitting}>
          {submitting ? <LoaderCircle className="animate-spin" /> : null}
          {labels.confirmOperation(request.type, itemCount)}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
```

Use these imports:

```tsx
import { CircleAlert, LoaderCircle, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
```

Keep `displaySource`, `displayDestination`, and `displayPath` unchanged.

- [ ] **Step 5: Convert MkdirDialog, SingleRenameDialog, and MediaPreview**

Replace the return block in `MkdirDialog.tsx` with:

```tsx
<Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
  <DialogContent aria-label={labels.directoryNamePrompt} className="sm:max-w-md">
    <DialogHeader><DialogTitle>{labels.mkdir}</DialogTitle></DialogHeader>
    <div className="grid gap-2">
      <Label htmlFor="mkdir-name">{labels.directoryNamePrompt}</Label>
      <Input id="mkdir-name" value={name} autoFocus onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} />
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
      <Button onClick={submit} disabled={!canSubmit}>{labels.confirm}</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Import `Button`, `Dialog`, `DialogContent`, `DialogFooter`, `DialogHeader`, `DialogTitle`, `Input`, and `Label` from `@/components/ui/*`.

Replace the return block in `SingleRenameDialog.tsx` with:

```tsx
<Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
  <DialogContent aria-label={labels.renameDialog} className="sm:max-w-md">
    <DialogHeader><DialogTitle>{labels.rename}</DialogTitle></DialogHeader>
    <ErrorBanner message={error} />
    <div className="grid gap-2">
      <Label htmlFor="single-rename-name">{labels.newName}</Label>
      <Input id="single-rename-name" value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus />
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
      <Button onClick={submit} disabled={submitting || !newName.trim()}>
        {submitting ? <LoaderCircle className="animate-spin" /> : null}{labels.rename}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Import `LoaderCircle`, the same Dialog primitives, `Button`, `Input`, and `Label`.

Replace the return block in `MediaPreview.tsx` with:

```tsx
<Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
  <DialogContent aria-label={labels.mediaPreview} className="max-w-5xl">
    <DialogHeader><DialogTitle>{name}</DialogTitle></DialogHeader>
    <div className="grid max-h-[78vh] place-items-center overflow-auto rounded-md bg-slate-950/5 p-2">
      {kind === "image" ? (
        <img src={url} alt={name} className="max-h-[74vh] max-w-full object-contain" />
      ) : (
        <video src={url} controls aria-label={name} className="max-h-[74vh] max-w-full" />
      )}
    </div>
  </DialogContent>
</Dialog>
```

Import `Dialog`, `DialogContent`, `DialogHeader`, and `DialogTitle`.

- [ ] **Step 6: Add global success toasts for created jobs**

In `web/src/main.tsx`, import `Toaster` and render it beside `App`:

```tsx
import { Toaster } from "@/components/ui/sonner";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster position="bottom-right" richColors />
  </StrictMode>,
);
```

In `DualPane.tsx`, import `toast` from `sonner` and update `handleJobCreated`:

```tsx
function handleJobCreated(id: string) {
  clearSelections();
  setJobsOpen(true);
  toast.success(labels.jobCreated);
  void refreshWhenJobFinishes(id);
}
```

At the top of `DualPane.test.tsx`, add:

```tsx
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
```

Append this assertion to the existing test that creates an operation job:

```tsx
expect(toast.success).toHaveBeenCalledWith("Background job created");
```

- [ ] **Step 7: Run dialog tests and commit**

Run:

```bash
npm --prefix web test -- --run src/components/OperationPreview.test.tsx src/components/MkdirDialog.test.tsx src/components/SingleRenameDialog.test.tsx src/components/MediaPreview.test.tsx src/components/DualPane.test.tsx
```

Expected: PASS. Dialogs expose `role="dialog"`, deletion is destructive and item-counted, loading prevents duplicate submission, and successful job creation emits a toast.

Commit:

```bash
git add web/src/components/OperationPreview.tsx web/src/components/OperationPreview.test.tsx web/src/components/MkdirDialog.tsx web/src/components/MkdirDialog.test.tsx web/src/components/SingleRenameDialog.tsx web/src/components/SingleRenameDialog.test.tsx web/src/components/MediaPreview.tsx web/src/components/MediaPreview.test.tsx web/src/components/DualPane.tsx web/src/components/DualPane.test.tsx web/src/main.tsx web/src/i18n.ts
git commit -m "feat: redesign operation dialogs"
```

### Task 7: Redesign PowerRename as a Split Large Dialog

**Files:**
- Modify: `web/src/components/RenameDialog.tsx`
- Modify: `web/src/components/RenameDialog.test.tsx`
- Modify: `web/src/components/DualPane.test.tsx`
- Modify: `web/src/i18n.ts`

- [ ] **Step 1: Write failing tests for the split layout and item-count action**

Append to `web/src/components/RenameDialog.test.tsx`:

```tsx
it("renders controls and live preview in separate desktop columns", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: false,
    items: [
      { sourcePath: "a.txt", oldName: "a.txt", newName: "x.txt", changed: true, conflict: false },
      { sourcePath: "b.txt", oldName: "b.txt", newName: "y.txt", changed: true, conflict: false },
    ],
  });
  render(<RenameDialog rootId="data" paths={["a.txt", "b.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(screen.getByRole("dialog", { name: "Rename dialog" })).toBeInTheDocument();
  expect(screen.getByTestId("rename-options-column")).toBeInTheDocument();
  expect(screen.getByTestId("rename-preview-column")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Rename 2 items" })).toBeEnabled();
});
```

Update existing assertions from `Run rename` to `Rename 1 item`, and from `role="region"` to `role="dialog"` in `RenameDialog.test.tsx` and `DualPane.test.tsx`.

- [ ] **Step 2: Run RenameDialog tests and verify they fail**

Run:

```bash
npm --prefix web test -- --run src/components/RenameDialog.test.tsx src/components/DualPane.test.tsx
```

Expected: FAIL because the old dialog is single-column, uses a region, and labels the action `Run rename`.

- [ ] **Step 3: Add live-preview and count copy**

Add these fields to `UIStrings`:

```ts
livePreview: string;
renamePreviewSummary(changed: number, total: number): string;
renameItems(count: number): string;
```

Add to `strings.en`:

```ts
livePreview: "Live preview",
renamePreviewSummary: (changed, total) => `${changed} changes · ${total} items`,
renameItems: (count) => `Rename ${count} ${count === 1 ? "item" : "items"}`,
```

Add to `strings["zh-CN"]`:

```ts
livePreview: "实时预览",
renamePreviewSummary: (changed, total) => `${changed} 项更改 · 共 ${total} 项`,
renameItems: (count) => `重命名 ${count} 项`,
```

- [ ] **Step 4: Implement the split PowerRename dialog**

Add a submitting state and update `run`:

```tsx
const [submitting, setSubmitting] = useState(false);

async function run() {
  setSubmitting(true);
  setError(null);
  try {
    const job = await api.renameCreateJob({ rootId, paths, options });
    onOptionsCommitted?.({ ...options });
    onJobCreated(job.id);
  } catch (err) {
    setError(err instanceof Error ? err.message : labels.renameFailed);
  } finally {
    setSubmitting(false);
  }
}
```

Add this helper below the component:

```tsx
function CheckOption({ id, checked, label, onCheckedChange }: { id: string; checked: boolean; label: string; onCheckedChange(checked: boolean): void }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <Label htmlFor={id} className="text-xs font-normal">{label}</Label>
    </div>
  );
}
```

Replace the return block with the following structure. The existing `update`, `setTargetMode`, and `setTransform` functions remain unchanged.

```tsx
const changedCount = items.filter((item) => item.changed).length;

return (
  <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent aria-label={labels.renameDialog} className="flex h-[min(760px,90vh)] max-w-6xl flex-col">
      <DialogHeader>
        <DialogTitle>{labels.powerRename}</DialogTitle>
        <DialogDescription>{labels.renamePreviewSummary(changedCount, items.length)}</DialogDescription>
      </DialogHeader>
      <ErrorBanner message={error} />
      <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-4">
        <section data-testid="rename-options-column" className="min-h-0 space-y-4 overflow-auto border-r pr-4">
          <div className="grid gap-2">
            <Label htmlFor="rename-search">{labels.search}</Label>
            <Input id="rename-search" value={options.search} onChange={(event) => update({ search: event.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rename-replace">{labels.replace}</Label>
            <Input id="rename-replace" value={options.replace} onChange={(event) => update({ replace: event.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CheckOption id="rename-regex" checked={options.useRegex} label={labels.useRegularExpressions} onCheckedChange={(checked) => update({ useRegex: checked })} />
            <CheckOption id="rename-case" checked={options.caseSensitive} label={labels.caseSensitive} onCheckedChange={(checked) => update({ caseSensitive: checked })} />
            <CheckOption id="rename-all" checked={options.matchAll} label={labels.matchAllOccurrences} onCheckedChange={(checked) => update({ matchAll: checked })} />
          </div>
          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-xs font-semibold">{labels.target}</legend>
            <CheckOption id="rename-name" checked={options.nameOnly} label={labels.nameOnly} onCheckedChange={(checked) => setTargetMode("name", checked)} />
            <CheckOption id="rename-extension" checked={options.extensionOnly} label={labels.extensionOnly} onCheckedChange={(checked) => setTargetMode("extension", checked)} />
            <CheckOption id="rename-full" checked={options.fullName} label={labels.fullName} onCheckedChange={(checked) => setTargetMode("both", checked)} />
          </fieldset>
          <fieldset className="grid grid-cols-2 gap-3 rounded-md border p-3">
            <legend className="px-1 text-xs font-semibold">{labels.textTransform}</legend>
            <CheckOption id="rename-uppercase" checked={options.uppercase} label={labels.uppercase} onCheckedChange={(checked) => setTransform("uppercase", checked)} />
            <CheckOption id="rename-lowercase" checked={options.lowercase} label={labels.lowercase} onCheckedChange={(checked) => setTransform("lowercase", checked)} />
            <CheckOption id="rename-titlecase" checked={options.titlecase} label={labels.titlecase} onCheckedChange={(checked) => setTransform("titlecase", checked)} />
            <CheckOption id="rename-capitalized" checked={options.capitalized} label={labels.capitalized} onCheckedChange={(checked) => setTransform("capitalized", checked)} />
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <CheckOption id="rename-exclude-files" checked={options.excludeFiles} label={labels.excludeFiles} onCheckedChange={(checked) => update({ excludeFiles: checked, includeFiles: !checked })} />
            <CheckOption id="rename-exclude-folders" checked={options.excludeFolders} label={labels.excludeFolders} onCheckedChange={(checked) => update({ excludeFolders: checked, includeDirs: !checked })} />
            <CheckOption id="rename-exclude-subfolders" checked={options.excludeSubfolders} label={labels.excludeSubfolders} onCheckedChange={(checked) => update({ excludeSubfolders: checked, includeSubfolders: !checked })} />
            <CheckOption id="rename-enumerate" checked={options.enumerateItems} label={labels.enumerateItems} onCheckedChange={(checked) => update({ enumerateItems: checked, enumerate: checked })} />
            <CheckOption id="rename-randomize" checked={options.randomizeItems} label={labels.randomizeItems} onCheckedChange={(checked) => update({ randomizeItems: checked })} />
          </div>
        </section>
        <section data-testid="rename-preview-column" className="min-h-0 overflow-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>{labels.source}</TableHead><TableHead>{labels.old}</TableHead><TableHead>{labels.new}</TableHead><TableHead>{labels.status}</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((item) => (
              <TableRow key={item.sourcePath} className={item.changed ? "bg-blue-50" : undefined}>
                <TableCell>{item.sourcePath}</TableCell><TableCell>{item.oldName}</TableCell><TableCell className={item.changed ? "font-medium text-blue-700" : undefined}>{item.newName}</TableCell><TableCell className={item.conflict ? "text-destructive" : "text-emerald-700"}>{item.conflict ? item.errorText || item.errorCode : labels.ready}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </section>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
        <Button onClick={run} disabled={hasConflict || submitting}>
          {submitting ? <LoaderCircle className="animate-spin" /> : null}{labels.renameItems(paths.length)}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
```

Import `LoaderCircle`, `Button`, `Checkbox`, the Dialog primitives, `Input`, `Label`, and Table primitives from the same shadcn paths used in Task 6.

- [ ] **Step 5: Update existing PowerRename assertions**

Change the highlight assertions in `RenameDialog.test.tsx` to:

```tsx
expect((await screen.findByText("photo.txt")).closest("tr")).toHaveClass("bg-blue-50");
expect(screen.getAllByText("notes.txt")[0].closest("tr")).not.toHaveClass("bg-blue-50");
```

Apply these exact query changes in `RenameDialog.test.tsx` and `DualPane.test.tsx`:

```tsx
screen.getByRole("button", { name: "Run rename" })
// becomes
screen.getByRole("button", { name: "Rename 1 item" })

screen.getByRole("button", { name: "运行重命名" })
// becomes
screen.getByRole("button", { name: "重命名 1 项" })

screen.findByRole("region", { name: "Rename dialog" })
// becomes
screen.findByRole("dialog", { name: "Rename dialog" })
```

Do not remove the existing preview-request, option-visibility, committed-settings, Chinese-label, conflict, or job-creation assertions.

- [ ] **Step 6: Run PowerRename tests and commit**

Run:

```bash
npm --prefix web test -- --run src/components/RenameDialog.test.tsx src/components/DualPane.test.tsx
```

Expected: PASS. Controls and preview are separate columns, changed rows remain highlighted, conflicts disable submission, and committed options still reopen after a successful rename job.

Commit:

```bash
git add web/src/components/RenameDialog.tsx web/src/components/RenameDialog.test.tsx web/src/components/DualPane.test.tsx web/src/i18n.ts
git commit -m "feat: redesign powerrename dialog"
```

### Task 8: Remove Legacy Styling and Run Full Acceptance Verification

**Files:**
- Create: `web/playwright.config.ts`
- Modify: `web/src/styles.css`
- Modify: `web/src/styles.test.ts`
- Modify: `web/e2e/filebutler.spec.ts`
- Delete: `web/src/App.css`
- Delete: `web/src/index.css`
- Delete: `web/src/assets/react.svg`
- Delete: `web/src/assets/vite.svg`
- Delete: `web/src/assets/hero.png`

- [ ] **Step 1: Replace legacy CSS assertions with redesign contracts**

Replace `web/src/styles.test.ts` with:

```ts
// @ts-nocheck
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/styles.css", "utf8");

it("loads Tailwind and shadcn theme variables", () => {
  expect(css).toContain('@import "tailwindcss";');
  expect(css).toContain("--radius: 0.5rem;");
  expect(css).toContain("--background:");
  expect(css).toContain("--primary:");
});

it("keeps the application desktop-only and pane scrolling internal", () => {
  expect(css).toContain("min-width: 1024px;");
  expect(rule(".workspace")).toContain("overflow: hidden;");
  expect(rule(".file-pane")).toContain("overflow: hidden;");
  expect(rule(".file-list")).toContain("overflow: auto;");
});

it("keeps compact sticky file headers and an active-pane ring", () => {
  expect(rule(".file-table thead th")).toContain("position: sticky;");
  expect(rule(".file-table thead th")).toContain("height: 29px;");
  expect(rule('.file-pane[data-active="true"]')).toContain("box-shadow:");
});

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}
```

- [ ] **Step 2: Run the style test before cleanup**

Run:

```bash
npm --prefix web test -- --run src/styles.test.ts
```

Expected: FAIL until the final stylesheet contains the Tailwind import, shadcn variables, desktop minimum width, compact table rules, and active-pane selector.

- [ ] **Step 3: Remove legacy rules and unused Vite assets**

Make `web/src/styles.css` contain only:

1. The Tailwind import and shadcn theme blocks generated in Task 1.
2. The root, body, and desktop minimum-width rules from Task 1.
3. File pane, table, path suggestion, resize handle, drag selection, workspace, and divider mechanics from Tasks 3 and 4.
4. No `.modal-backdrop`, `.modal`, `.jobs-panel`, `.auth-form`, `.workspace-toolbar`, or old hard-coded `#2b72c4` rules.

Verify the removal with:

```bash
rg -n "modal-backdrop|jobs-panel|auth-form|workspace-toolbar|#2b72c4" web/src/styles.css
```

Expected: no output.

Remove unused starter files:

```bash
git rm web/src/App.css web/src/index.css web/src/assets/react.svg web/src/assets/vite.svg web/src/assets/hero.png
```

Run:

```bash
npm --prefix web test -- --run src/styles.test.ts
```

Expected: PASS.

- [ ] **Step 4: Extend the Playwright smoke test for the approved workbench**

Create `web/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:8080",
  },
});
```

After the existing login flow in `web/e2e/filebutler.spec.ts`, replace the final two pane assertions with:

```ts
await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
await expect(page.getByRole("region", { name: "Left pane" })).toBeVisible();
await expect(page.getByRole("region", { name: "Right pane" })).toBeVisible();
await expect(page.getByRole("button", { name: "Copy to right pane" })).toBeDisabled();
await page.getByRole("button", { name: "Jobs" }).first().click();
await expect(page.getByRole("dialog", { name: "Jobs" })).toBeVisible();
await page.keyboard.press("Escape");
await expect(page.getByRole("dialog", { name: "Jobs" })).not.toBeVisible();
```

If the browser locale is not English, select English before these assertions:

```ts
await page.getByRole("combobox", { name: "Language" }).click();
await page.getByRole("option", { name: "English" }).click();
```

- [ ] **Step 5: Run the complete frontend and backend acceptance suite**

Run in this order:

```bash
npm --prefix web test -- --run
npm --prefix web run lint
npm --prefix web run build
go test ./...
```

Expected:

- Vitest reports all component and style tests passing.
- ESLint exits with no errors or warnings introduced by the redesign.
- TypeScript and Vite produce the production frontend bundle.
- All Go packages pass without backend changes.

Start FileButler through the repository Compose configuration and run the smoke test:

```bash
mkdir -p data downloads media
docker compose up --build -d
until curl --fail --silent http://127.0.0.1:8080/api/init/status >/dev/null; do sleep 1; done
cd web
npx playwright test e2e/filebutler.spec.ts
cd ..
docker compose down
```

Expected: the initialization/login flow completes, the navigation rail and both panes are visible, the empty-selection copy action is disabled, and the jobs Sheet opens and closes.

- [ ] **Step 6: Inspect the production workbench at desktop widths**

Use browser developer tools at 1024×768, 1440×900, and 1920×1080. At each size verify:

- Both panes remain side by side and independently scrollable.
- The toolbar remains usable; at 1024 pixels labels may compact but controls must not overlap.
- The active pane, selected rows, destructive delete action, and disabled actions are visually distinct.
- Operation dialogs fit within the viewport; PowerRename uses two columns.
- No search, help, settings, account menu, dark-mode toggle, or other placeholder feature is visible.

If inspection finds a layout defect, add a failing component or style test that reproduces it before changing code, then rerun Step 5.

- [ ] **Step 7: Commit cleanup and acceptance updates**

```bash
git add web/playwright.config.ts web/src/styles.css web/src/styles.test.ts web/e2e/filebutler.spec.ts
git add -u web/src
git commit -m "test: verify shadcn workbench redesign"
```

After the commit, run:

```bash
git status --short
```

Expected: no output.
