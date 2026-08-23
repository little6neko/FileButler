# Taskbar Control Order Design

## Goal

Improve the visual grouping of the controls on the right side of the system taskbar.

## Approved UI

The taskbar order, from left to right, will be:

1. FileButler brand
2. Window buttons
3. Running-jobs button
4. Workspace-mode switch
5. Language icon and selector
6. Version label

The running-jobs button and workspace-mode switch will both use the existing outlined button style. This applies in compact and full modes.

## Implementation

`WorkspaceShell` will render the running-jobs button immediately before the workspace-mode switch. The running-jobs button variant will change from `ghost` to `outline`; the mode button keeps its current `outline` variant.

No new state, callback, CSS rule, or component abstraction is required. Existing behavior remains unchanged:

- The running-jobs button continues to toggle the jobs sidebar.
- The workspace-mode switch continues to change modes and close the jobs sidebar through the existing workspace logic.
- Window buttons and taskbar overflow behavior remain unchanged.

## Verification

Component tests will verify:

- The running-jobs button appears before the workspace-mode switch in DOM order.
- Both controls use the outlined variant.
- Existing jobs-sidebar and mode-switch behavior tests continue to pass.

The frontend test suite, lint, and production build will be run after implementation.

## Non-goals

- Changing button labels, icons, spacing, dimensions, or active states.
- Changing jobs-sidebar behavior.
- Changing mode-switch behavior.
