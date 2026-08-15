# Workspace Version Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the immutable build version at the bottom of the authenticated workspace navigation rail and inject the same release tag into the frontend bundle and Docker image metadata.

**Architecture:** A focused frontend module normalizes `VITE_APP_VERSION` and exposes the build-time display value. `AppShell` renders that value without adding runtime API state, while Docker and the release workflow pass one tag through to both the frontend build and OCI image label.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, Tailwind CSS, Docker multi-stage builds, GitHub Actions

---

### Task 1: Add Build Version Normalization

**Files:**
- Create: `web/src/version.test.ts`
- Create: `web/src/version.ts`

- [ ] **Step 1: Write the failing normalization test**

Create `web/src/version.test.ts`:

```ts
import { expect, it } from "vitest";
import { formatAppVersion } from "./version";

it.each<[string | undefined, string]>([
  ["v0.1.5", "v0.1.5"],
  ["0.1.5", "v0.1.5"],
  [" 1.2.3-beta.1 ", "v1.2.3-beta.1"],
  ["", "dev"],
  ["   ", "dev"],
  [undefined, "dev"],
])("formats build version %p as %s", (value, expected) => {
  expect(formatAppVersion(value)).toBe(expected);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `web`:

```bash
npm test -- --run src/version.test.ts
```

Expected: FAIL because `./version` does not exist.

- [ ] **Step 3: Implement the version module**

Create `web/src/version.ts`:

```ts
export function formatAppVersion(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return "dev";
  return normalized.startsWith("v") ? normalized : `v${normalized}`;
}

export const appVersion = formatAppVersion(import.meta.env.VITE_APP_VERSION);
```

- [ ] **Step 4: Run the normalization test**

Run from `web`:

```bash
npm test -- --run src/version.test.ts
```

Expected: PASS for all six version inputs.

- [ ] **Step 5: Commit the version module**

```bash
git add web/src/version.ts web/src/version.test.ts
git commit -m "feat: normalize frontend build version"
```

### Task 2: Render the Version in the Workspace Rail

**Files:**
- Modify: `web/src/components/AppShell.test.tsx`
- Modify: `web/src/components/AppShell.tsx`

- [ ] **Step 1: Add a failing component assertion**

Pass an explicit prerelease value to `AppShell` in `web/src/components/AppShell.test.tsx`:

```tsx
<AppShell
  labels={strings.en}
  activeJobCount={2}
  onJobsOpen={onJobsOpen}
  languageControl={<span>language</span>}
  version="v1.2.3-beta.1"
>
  <p>workspace</p>
</AppShell>
```

Add these assertions before clicking the Jobs button:

```ts
const version = screen.getByText("v1.2.3-beta.1");
expect(version).toHaveAttribute("title", "FileButler v1.2.3-beta.1");
expect(version).toHaveClass("truncate");
```

- [ ] **Step 2: Run the component test to verify it fails**

Run from `web`:

```bash
npm test -- --run src/components/AppShell.test.tsx
```

Expected: FAIL because `AppShell` does not accept or render `version`.

- [ ] **Step 3: Add the bottom-anchored version label**

Replace `web/src/components/AppShell.tsx` with:

```tsx
import type { ReactNode } from "react";
import { BriefcaseBusiness, Files, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UIStrings } from "../i18n";
import { appVersion } from "../version";

export function AppShell({
  labels,
  activeJobCount,
  onJobsOpen,
  languageControl,
  version = appVersion,
  children,
}: {
  labels: UIStrings;
  activeJobCount: number;
  onJobsOpen(): void;
  languageControl: ReactNode;
  version?: string;
  children: ReactNode;
}) {
  return (
    <main className="grid h-screen min-w-[1024px] grid-cols-[54px_minmax(0,1fr)] overflow-hidden bg-slate-100">
      <nav aria-label={labels.workspaceNavigation} className="flex flex-col items-center border-r bg-white px-2 py-2.5">
        <div className="mb-4 grid size-8 place-items-center rounded-lg bg-blue-600 font-bold text-white shadow-sm">F</div>
        <Button aria-current="page" aria-label={labels.files} title={labels.files} size="icon" variant="secondary"><Files /></Button>
        <Button aria-label={labels.jobs} title={labels.jobs} size="icon" variant="ghost" onClick={onJobsOpen}><ListChecks /></Button>
        <span
          className="mt-auto max-w-full truncate px-0.5 text-center text-[10px] font-medium leading-4 text-slate-400"
          title={`FileButler ${version}`}
        >
          {version}
        </span>
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
```

- [ ] **Step 4: Run the component and normalization tests**

Run from `web`:

```bash
npm test -- --run src/components/AppShell.test.tsx src/version.test.ts
```

Expected: PASS, including the full hover title and truncation class assertions.

- [ ] **Step 5: Commit the workspace display**

```bash
git add web/src/components/AppShell.tsx web/src/components/AppShell.test.tsx
git commit -m "feat: show version in workspace rail"
```

### Task 3: Inject One Release Version Through Docker

**Files:**
- Modify: `Dockerfile`
- Modify: `.github/workflows/publish-image.yml`

- [ ] **Step 1: Confirm the current release tag is not passed to the frontend**

Run from the repository root:

```bash
rg -n "VITE_APP_VERSION|build-args" Dockerfile .github/workflows/publish-image.yml
```

Expected: no matches, confirming that the release tag cannot currently reach the frontend bundle.

- [ ] **Step 2: Wire the Docker build argument into both outputs**

Replace `Dockerfile` with:

```dockerfile
ARG VERSION=dev

FROM node:25-alpine AS frontend
ARG VERSION
ENV VITE_APP_VERSION=${VERSION}
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM golang:1.26-alpine AS backend
WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /src/web/dist ./web/dist
RUN go build -o /out/filebutler ./cmd/filebutler

FROM alpine:3.22
ARG VERSION
LABEL org.opencontainers.image.version="${VERSION}"
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=backend /out/filebutler /usr/local/bin/filebutler
COPY --from=frontend /src/web/dist /app/web/dist
COPY configs/filebutler.docker.yaml /app/filebutler.yaml
EXPOSE 8080
ENTRYPOINT ["filebutler"]
CMD ["-config", "/app/filebutler.yaml"]
```

- [ ] **Step 3: Pass the pushed Git tag from GitHub Actions**

Add `build-args` to the `Build and push image` step in `.github/workflows/publish-image.yml`:

```yaml
      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.metadata.outputs.tags }}
          labels: ${{ steps.metadata.outputs.labels }}
          build-args: |
            VERSION=${{ github.ref_name }}
          provenance: false
          sbom: false
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 4: Verify a release version is embedded in a frontend production build**

Run from `web`:

```bash
VITE_APP_VERSION=v9.8.7 npm run build
rg -F "v9.8.7" dist/assets
```

Expected: the build succeeds and the generated JavaScript contains `v9.8.7`.

- [ ] **Step 5: Verify the Docker build argument and image label**

Run from the repository root when Docker is available:

```bash
docker build --build-arg VERSION=v9.8.7 --tag filebutler:version-display-test .
docker image inspect filebutler:version-display-test --format '{{ index .Config.Labels "org.opencontainers.image.version" }}'
```

Expected: the image builds and inspection prints `v9.8.7`.

- [ ] **Step 6: Commit the release wiring**

```bash
git add Dockerfile .github/workflows/publish-image.yml
git commit -m "build: inject release version into frontend"
```

### Task 4: Run Full Verification

**Files:**
- Verify only; no additional files expected

- [ ] **Step 1: Run the full frontend test suite**

Run from `web`:

```bash
npm test -- --run
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run lint**

Run from `web`:

```bash
npm run lint
```

Expected: ESLint exits successfully with no errors.

- [ ] **Step 3: Run an unversioned production build**

Run from `web`:

```bash
npm run build
rg -F "dev" dist/assets
```

Expected: the build succeeds and the generated bundle includes the local-build fallback `dev`.

- [ ] **Step 4: Review the scoped diff and repository state**

Run from the repository root:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only pre-existing SSE changes remain uncommitted after the three feature commits.
