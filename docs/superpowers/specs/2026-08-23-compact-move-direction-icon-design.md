# Compact move direction icon design

## Goal

Make the compact workspace's Move action visually indicate the destination pane instead of always showing a right-pointing arrow.

## Behavior

- Moving from the right pane to the left pane uses the `MoveLeft` icon.
- Moving from the left pane to the right pane uses the existing `MoveRight` icon.
- The direction applies consistently to the compact toolbar and compact context menu because both surfaces use the same action descriptor.
- Copy keeps its existing Copy icon.

Labels, enabled states, callbacks, operation previews, and move behavior do not change.

## Implementation

The compact action factory accepts an explicit destination direction (`left` or `right`) and chooses the matching Lucide move icon. The workspace derives this direction from the existing opposite-pane calculation and passes it alongside the localized destination label. Direction must not be inferred from translated text.

The full workspace has no cross-pane Move action, so it requires no icon change.

## Verification

- Unit tests assert that a left destination produces `MoveLeft` and a right destination produces `MoveRight`.
- Existing action order, enablement, and command-dispatch tests continue to pass.
- Browser verification checks the right pane's Move action points left and the left pane's Move action points right in both toolbar and context-menu surfaces.
- Run the complete frontend tests, lint, build, and relevant E2E coverage before updating the existing `0.0.0.0:8082` test service.
