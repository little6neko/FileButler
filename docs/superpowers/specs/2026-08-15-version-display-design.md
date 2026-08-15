# Workspace Version Display Design

## Goal

Show the running FileButler build version in a persistent but low-emphasis location so an administrator can quickly confirm which release is deployed.

## Scope

The version appears only at the bottom of the authenticated workspace's left navigation rail. It is not added to the login or initialization screens, the page header, or the jobs sheet.

The compact label displays values such as `v0.1.5`. It uses subdued text below the navigation actions and remains anchored to the bottom of the rail. Long prerelease versions are truncated within the fixed-width rail, with the complete `FileButler <version>` value available through the native hover title. The version is a technical token and does not require translation.

## Version Source

The frontend reads `VITE_APP_VERSION` at build time through a small version module. Values already beginning with `v` are displayed unchanged; other release values receive a `v` prefix. A missing or blank value displays `dev`, making local and unversioned builds explicit rather than reporting a stale release.

Docker uses one global `VERSION` build argument. The frontend build stage maps it to `VITE_APP_VERSION`, and the final image uses the same value for `org.opencontainers.image.version`. The release workflow passes the pushed Git tag, such as `v0.1.6`, as `VERSION`. Local non-Docker builds may set `VITE_APP_VERSION` directly and otherwise display `dev`.

No runtime API call or database field is added. The version is immutable for the lifetime of the static frontend bundle and cannot disagree with the image version produced by the release workflow.

## Component Changes

- A focused frontend version module owns normalization and the `dev` fallback.
- `AppShell` accepts an optional version value defaulting to the build version and renders it at the navigation rail bottom.
- The Dockerfile forwards its build argument into both the frontend bundle and final image label.
- The image publication workflow supplies the Git tag as the Docker build argument.

## Testing

- Unit-test version normalization for prefixed, unprefixed, blank, and whitespace values.
- Extend `AppShell` tests to verify the visible compact version and full hover title.
- Run frontend tests, lint, and a production build with an injected release version.
- Build the Docker image far enough to verify the build argument reaches the frontend bundle when practical.

## Non-Goals

- An About dialog or settings page.
- Displaying commit hashes or build timestamps.
- Fetching version metadata at runtime.
- Showing the version on authentication screens.
