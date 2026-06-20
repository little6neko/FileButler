# File Table Sorting Resize And PowerRename Highlight Design

## Goal

Improve the file pane table and PowerRename preview without replacing the current UI architecture.

## Requirements

- The gray separator between the header row and the first file row must be continuous across the select/clear, name, type, size, and modified columns.
- File pane columns must be resizable by dragging the column divider in the header.
- Clicking a header sorts that pane by the clicked column; clicking the same header toggles ascending and descending order.
- PowerRename must receive selected files in the current visible table order, including the active sort order.
- PowerRename preview rows that match the current rename rule must be visually highlighted.

## Design

Use the existing `FilePane` table. Add local sort and column width state inside `FilePane`, and report the current ordered entries to `DualPane` through a callback. `DualPane` stores each pane's visible order and uses it when opening PowerRename, so the backend receives paths in the same order the user sees.

Column resizing stays local to each pane. Header cells render a sort button and a narrow resize handle at the right edge. CSS uses collapsed borders for the file table and fixed table layout so header and body separators align.

PowerRename preview uses existing backend `PlanItem.changed` to detect matches. A changed item row receives a highlight class. Unchanged rows remain normal; conflicted rows can still show status text through the existing conflict logic.

## Testing

- `FilePane` unit tests cover header sorting and resize handle events.
- `DualPane` unit tests cover PowerRename path order matching visible sort order.
- `RenameDialog` unit tests cover changed rows receiving the highlight class.
- Existing frontend and Go tests remain green.
