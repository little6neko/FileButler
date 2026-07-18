# FileButler shadcn/ui Redesign Design

Date: 2026-07-18

## Goal

Redesign FileButler as a polished desktop-only dual-pane file workspace using shadcn/ui. Preserve all existing file-management behavior while improving visual hierarchy, operation clarity, status feedback, and consistency across the workspace, dialogs, jobs panel, and authentication screens.

## Approved Direction

- Product structure: workbench redesign rather than a visual-only reskin.
- Visual style: clean Slate neutrals with restrained Blue accents.
- Target environment: desktop only, optimized for viewports at least 1024 pixels wide.
- File-list density: compact rows approximately 28 pixels high.
- Functional scope: existing capabilities only. The redesign must not introduce non-functional search, help, settings, or account controls.

## Existing Capabilities to Preserve

- Administrator initialization and login.
- English, Simplified Chinese, and automatic browser-language selection.
- Two independently navigable and resizable file panes.
- Root selection, editable paths, directory suggestions, breadcrumbs, and refresh.
- Sorting and resizable file-table columns.
- Individual, select-all, and drag-box file selection.
- Media preview for supported file types.
- Copy, move, symbolic link, hard link, delete, and create-directory operations.
- Single-item rename and PowerRename batch rename.
- Dry-run operation previews, conflict reporting, background jobs, cancellation, and automatic pane refresh after job completion.

## Visual System

Use shadcn/ui components and tokens as the presentation foundation, with Tailwind CSS for layout and component composition and Lucide icons for operation semantics.

The default theme uses:

- Slate-like neutral surfaces and borders.
- Blue for the active pane, selected rows, primary actions, focus rings, and running progress.
- Red only for destructive actions and destructive confirmation.
- Green for completed or healthy job states.
- Amber for conflicts and warnings.
- Small radii, subtle shadows, and compact controls suitable for a desktop utility.

The interface remains light-theme only for this redesign. Dark mode is outside the current scope.

## Application Shell

The ready state uses a full-height application shell with four layers:

1. A narrow navigation rail containing only the file workspace and jobs entry.
2. A top bar containing the FileButler identity, workspace subtitle, active-job status, and language selector.
3. A grouped action toolbar for file operations.
4. The resizable dual-pane workspace.

The rail must not include placeholder destinations. Jobs opens a right-side sheet instead of navigating away from the workspace.

The loading, initialization, and login states use the same branding and design tokens but do not render the workspace rail or file-operation toolbar.

## Action Toolbar

Group actions by intent:

- Transfer: copy and move.
- Links: symbolic link and hard link.
- File management: create directory, single rename, and PowerRename.
- Destructive: delete, visually separated from other actions.

Copy and move labels explicitly include their destination based on the active pane, for example, "Copy to right pane" when the left pane is active. This is a presentation change only; requests continue to use the current active-pane and opposite-pane state.

Button availability continues to follow existing rules:

- Copy, move, links, delete, and PowerRename require at least one selected path.
- Single rename requires exactly one selected path.
- Create directory is always available when a pane root is active.

The toolbar also displays the active selection count. Tooltips provide full labels for compact icon controls.

## Dual-Pane Workspace

Each pane is a bordered surface with four internal regions:

1. Root selector, editable path field, and refresh control.
2. Breadcrumb navigation.
3. Sticky-header file table.
4. Status footer with selection count, selected size when available, and total visible item count.

The active pane receives a restrained blue border and focus ring. Selected rows use a pale-blue background and a blue leading accent. Inactive panes remain neutral.

File rows remain approximately 28 pixels high. The table retains sortable and resizable columns, fixed-height rows, horizontal overflow, drag-box selection, and the current double-click behavior for opening directories or previewable media.

File and directory names use Lucide file-type and folder icons. Symlink targets remain visible as secondary text without increasing row height.

The pane divider keeps the existing drag-to-resize behavior and receives a larger invisible hit target than its visible handle.

## Jobs Sheet

Replace the fixed jobs panel with a shadcn Sheet opening from the right edge. The sheet overlays rather than resizes the dual-pane workspace.

The sheet contains:

- All, running, and completed filters derived from the loaded job list.
- Compact job cards showing operation type, translated status, numeric progress, and a Progress bar.
- A selected-job detail area with item-level information already returned by the existing job endpoint.
- A cancel action for running or cancel-requested jobs.

The top bar shows active-job status and opens the same sheet. Existing polling intervals and job-completion pane refresh behavior remain unchanged.

## Dialogs and Secondary Surfaces

Use shadcn Dialog for operation preview, create directory, single rename, PowerRename, and media preview.

### Operation Preview

- State the operation and pane destination in the title and description.
- Present source, destination, and status in a compact table.
- Show conflicts in an Alert and keep confirmation disabled while conflicts exist.
- Use an operation-specific confirmation label such as "Start copy" or "Delete 3 items."
- Use destructive styling and explicit irreversible wording for delete.

### PowerRename

Use a large desktop dialog with controls on the left and the live preview table on the right. Preserve all existing rename options and mutually exclusive target and text-transform behavior.

Changed preview rows use a pale-blue background and blue new-name text. Conflicts use warning or destructive colors. The primary action includes the number of items to rename and remains disabled when conflicts exist.

### Authentication

Initialization and login use a branded split layout with a concise product statement on one side and a shadcn Card form on the other. Existing validation and API calls remain unchanged. Errors appear near the form using Alert.

## Component Architecture

Keep server APIs and backend packages unchanged. The frontend redesign separates orchestration from presentation:

- `App` continues to own boot state and language mode.
- `AppShell` renders the ready-state rail, top bar, toolbar, and workspace frame.
- `DualPane` continues to own roots, pane state, active pane, operation requests, dialog visibility, job refresh, and media-preview state.
- `ActionToolbar` receives derived selection and destination state and emits existing action callbacks.
- `FilePane` retains path editing, suggestions, sorting, column sizing, and drag-selection behavior.
- `FileTable`, `PaneHeader`, `Breadcrumbs`, and `PaneStatusBar` may be extracted from `FilePane` where doing so keeps each component focused without changing behavior.
- `JobsSheet` replaces the current `JobsPanel` presentation while retaining its API calls and polling behavior.
- Existing operation and rename dialog components retain their business state and switch to shared shadcn primitives.

Avoid a broad state-management rewrite. React state remains local to the components that already own each workflow.

## Data Flow

The API data flow remains unchanged:

1. `App` checks initialization and authentication.
2. `DualPane` loads roots, then independently browses each pane.
3. Pane interactions update the appropriate `PaneState`.
4. The toolbar derives its enabled state and destination labels from the active pane and active selection.
5. Operation dialogs perform the existing dry run before allowing job creation.
6. Created jobs clear selections, open the jobs sheet, and trigger the existing completion polling.
7. Terminal job states refresh both panes.

The redesign must not change request or response types.

## Loading, Error, and Success Feedback

- Use Skeleton rows for initial pane and preview loading where practical.
- Use a small Spinner inside submitting buttons and disable duplicate submission.
- Use Alert for request failures and conflicts that require user attention.
- Keep field validation adjacent to its input.
- Use Toast for transient confirmations such as successful job creation.
- Preserve meaningful empty states for empty directories and an empty job list.
- Do not silently discard API errors during user-triggered operations.

## Accessibility and Keyboard Behavior

- Preserve existing accessible names used by component and end-to-end tests where possible.
- All icon-only buttons require accessible labels and tooltips.
- Use visible focus rings based on the Blue accent token.
- Dialog and Sheet surfaces use focus trapping, Escape handling, and focus restoration from shadcn/Radix primitives.
- Table sorting continues to expose `aria-sort`.
- The active pane and selected rows must remain distinguishable without relying only on color.
- Compact 28-pixel rows do not reduce checkbox hit targets below the row area because the whole selection cell remains interactive.

## Desktop Layout Behavior

The application is optimized for desktop widths of 1024 pixels and above. The dual panes remain side by side and resizable. Mobile-specific navigation and a single-pane mobile mode are not required.

At the narrow end of the desktop range, toolbar labels may collapse into icon-and-tooltip controls before the file panes are allowed to become unusably narrow. The workspace itself must not stack vertically.

## Testing

Update existing tests without reducing behavioral coverage. Add focused coverage for:

- Direction-aware copy and move labels.
- Active-pane visual state and action derivation.
- Toolbar enabled and disabled rules.
- Opening and closing the jobs sheet.
- Job progress and cancel availability.
- Conflict alerts and disabled confirmations.
- Authentication validation in the redesigned forms.
- Existing sorting, column resizing, path suggestions, selection, drag selection, and rename behavior after component extraction.

Acceptance commands:

```bash
npm --prefix web test -- --run
npm --prefix web run lint
npm --prefix web run build
go test ./...
```

Run the Playwright smoke test against a locally started FileButler instance when the environment supports it.

## Acceptance Criteria

- All existing user-visible functionality remains available.
- The UI uses shadcn/ui primitives consistently instead of bespoke raw controls for primary surfaces.
- The approved desktop workbench, clean blue-white style, and compact file-list density are represented in the implementation.
- Active pane, operation destination, selection state, job progress, conflicts, and destructive actions are visually unambiguous.
- No placeholder features are visible.
- Frontend tests, lint, build, and Go tests pass.
