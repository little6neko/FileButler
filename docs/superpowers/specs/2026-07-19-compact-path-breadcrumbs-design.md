# Compact Path Breadcrumbs Design

Date: 2026-07-19

## Goal

Keep each file pane's breadcrumb navigation on one compact row while making the current directory and as many recent ancestors as possible fully visible. Preserve fast navigation to every hidden ancestor without allowing a long path to widen or wrap the pane.

## Approved Behavior

- Keep the breadcrumb row on one line and at its original full pane width.
- Use a 29-pixel breadcrumb grid track, including its 1-pixel lower divider, so the visible row is approximately the same height as the 28-pixel editable path input and does not unnecessarily reduce the file-list area.
- Keep the root, the first directory, and the current directory visible in normal desktop widths.
- After reserving those fixed items, add ancestors from right to left: the parent first, then grandparent, continuing toward the first directory while each complete label still fits.
- Replace one contiguous hidden middle range with a single clickable `…` control.
- Clicking `…` opens a menu containing every hidden directory in path order. Selecting an item navigates directly to that directory.
- Only directory names, the root control, and `…` are interactive. Separator slashes are plain text, are not focusable, do not navigate, and use the default cursor.
- Interactive directory labels and `…` use a pointer cursor and a visible hover/focus treatment.
- Retain the existing upper divider between the editable path row and the breadcrumb row.
- Add a lower divider of the same thickness and color between the breadcrumb row and the file table.
- Do not change the editable path input, directory suggestions, refresh control, file table, or backend APIs.

## Fitting Rules

For a path such as:

```text
/Games/Unity翻译/Projects/FileButler/web/components
```

the fitting algorithm treats `/`, `Games`, and `components` as the fixed set. It then evaluates `web`, `FileButler`, `Projects`, and `Unity翻译` in that order. Each candidate is included only when the resulting row, including separators and the `…` control when needed, fits completely.

Example results:

```text
Wide:   / / Games / Unity翻译 / Projects / FileButler / web / components
Medium: / / Games / … / FileButler / web / components
Narrow: / / Games / … / components
```

When all segments fit, the `…` control is absent. When a hidden range exists, it is always contiguous and the remaining labels stay in natural path order.

The root, first directory, and current directory are never selected for middle-range collapsing. No one-line design can show two arbitrarily long fixed labels inside a physically smaller pane. If their combined natural width exceeds the physical pane width, the row still must not expand or wrap; it clips only as an unavoidable last resort, and the existing editable path field remains the lossless full-path display and navigation fallback. Normal supported desktop widths must show all three fixed items completely.

## Component Design

Keep the behavior in `FilePane`, but separate calculation from rendering:

- `buildPathSegments` continues to produce ordered labels and destination paths.
- A pure fitting helper receives the ordered segment widths, separator width, overflow-control width, and available row width. It returns the visible suffix boundary and hidden middle range.
- The breadcrumb view renders explicit separator `<span>` elements instead of CSS pseudo-elements. This ensures separators are outside button hit areas and their widths are measurable.
- A `ResizeObserver` watches the breadcrumb container. Pane-divider resizing or viewport changes rerun the fitting calculation.
- DOM measurement reads the natural width of each complete directory button. The fitting helper performs the deterministic right-to-left selection.
- A layout effect applies the calculated visibility before paint where possible, avoiding a visible all-segments-then-collapse flash.
- The `…` control anchors an accessible menu. Hidden directories appear in path order and invoke the same `onPathChange` callback as visible directory buttons.

The fitting helper must not depend on browser APIs so its boundary behavior can be unit tested without relying on JSDOM layout.

## Interaction And Accessibility

- Visible directory buttons retain meaningful accessible names based on their labels.
- Root remains a dedicated button that navigates to `.`.
- Separator spans use `aria-hidden="true"` because the ordered buttons and navigation label already convey structure.
- The `…` button has a localized accessible label that includes the number of hidden directories.
- The hidden-directory menu supports pointer activation, keyboard navigation, Escape dismissal, outside-click dismissal, and focus restoration to `…`.
- Menu items expose their directory names and navigate to the corresponding accumulated path.
- Hover and keyboard focus styling appears only on actual controls, making the clickable regions visually unambiguous.

## Visual Design

- Breadcrumb grid track: 29 pixels total, with approximately 28 pixels of visible row content and a 1-pixel lower divider. Remove the conflicting 32-pixel minimum height from the current breadcrumb style.
- Horizontal padding: retain the existing full-width row padding.
- Text: keep the current compact font size and primary link color.
- Separators: muted foreground color with the default cursor.
- Dividers: `1px solid var(--border)` above and below the breadcrumb region.
- Overflow: no wrapping and no ordinary horizontal scrollbar; dynamic collapsing is the normal overflow treatment.
- File-table columns and sticky header remain unchanged.

## Data Flow

1. `currentPath` changes and `buildPathSegments` creates the full ordered path.
2. The breadcrumb measurement layer records the available width and each item's natural width.
3. The pure fitting helper reserves fixed items, then admits suffix ancestors from right to left.
4. The rendered row shows the calculated visible items and one `…` control for the hidden middle range.
5. Clicking a visible directory or a hidden-menu item calls `onPathChange` with its existing accumulated path.
6. Container resizing repeats measurement and fitting without changing navigation state.

## Testing

Focused tests will cover:

- All path segments rendering without `…` when they fit.
- The root, first directory, and current directory remaining in the normal collapsed layout.
- Parents being retained in right-to-left priority order at exact width boundaries.
- One contiguous middle range becoming a single `…` control.
- The `…` menu listing hidden directories in natural path order and navigating to the selected path.
- Resizing wider revealing more ancestors and resizing narrower hiding them again.
- Directory labels being buttons while separator slashes are non-interactive spans.
- Pointer, hover, row-height, and matching upper/lower divider styles.
- Existing editable-path, suggestion, and visible-segment navigation behavior remaining intact.

Frontend component tests, style assertions, lint, and the production build provide acceptance coverage. No backend tests are required for this presentation-only change, though the existing repository test suite should remain green.

## Acceptance Criteria

- Long paths never create a second breadcrumb line.
- The current directory is fully visible under normal supported desktop widths.
- The root, first directory, and current directory are excluded from middle-range collapsing and remain completely visible at normal supported desktop widths.
- Additional ancestors are retained from right to left, with complete labels only.
- Every collapsed directory remains reachable through the `…` menu.
- Separator slashes cannot be clicked or focused.
- The breadcrumb row is compact, full-width, and visibly bounded by matching upper and lower dividers.
- Existing path editing and directory navigation behavior is unchanged.
