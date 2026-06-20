# File Pane B Layout Design

Date: 2026-06-20

## Goal

Update the FileButler dual-pane browser to use the approved B layout: a path command bar with directory autocomplete, fixed-height file rows, select-all checkboxes, and browser-aware language selection with manual override.

## Requirements

- File list rows must stay fixed height and must not stretch vertically to fill the pane.
- Each file pane keeps a root selector, then uses a path input to navigate within that root.
- The path input offers directory suggestions from the currently browsed entries and supports keyboard selection with ArrowUp, ArrowDown, and Enter.
- The table header includes a select-all checkbox that selects or clears all visible entries in that pane.
- The UI supports English and Simplified Chinese.
- Language mode defaults to automatic browser detection and can be manually set to Auto, English, or 简体中文.

## Design

`FilePane` owns path input editing and suggestion keyboard behavior while `DualPane` continues to own the actual pane path state and selection state. Suggestions are local to visible directory entries to avoid adding new backend endpoints. Pressing Enter navigates to the typed path or the highlighted suggestion.

Internationalization is a small frontend module with a translation dictionary and helper functions. `App` owns the language mode so all child components receive translated labels consistently. The first implementation keeps labels local to the current UI surface and avoids a heavy i18n dependency.

## Testing

Component tests cover select-all, path input navigation, suggestion keyboard selection, and Chinese auto/manual language labels. Existing frontend test and build commands remain the acceptance checks.
