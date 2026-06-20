# PowerRename Alignment Design

## Goal

FileButler will split the current rename behavior into two commands:

- `Rename`: ordinary single-item rename. It is enabled only when exactly one file or folder is selected and prompts for one new basename.
- `PowerRename`: batch rename with rename logic aligned to Microsoft PowerToys PowerRename.

The alignment target is PowerRename rename semantics, not PowerToys WinUI or Windows Shell file operation UI. FileButler remains a Go server with a React UI and preserves root-boundary and conflict protections.

## PowerRename Scope

PowerRename support will implement the behavior expressed by the PowerToys `src/modules/powerrename` source:

- ECMAScript regular-expression search.
- Replacement-group semantics for `$0`, `$1` through `$9`, escaped dollar signs, and unmatched groups.
- Case-sensitive and case-insensitive matching, with case-insensitive as the default.
- First occurrence versus all occurrences.
- Name-only, extension-only, and full-name matching.
- Excluding files, folders, and subfolder contents.
- Uppercase, lowercase, titlecase, and capitalized output transforms.
- Enumeration tokens in replacement strings: `${}`, `${start=N}`, `${increment=N}`, `${padding=N}`.
- Random tokens in replacement strings: `${rstringalnum=N}`, `${rstringalpha=N}`, `${rstringdigit=N}`, `${ruuidv4}`.
- File time templates for creation, modification, and access time.
- EXIF and XMP metadata templates used by PowerRename, including date, camera, image, author, copyright, GPS, and document fields.

Where PowerRename relies on Windows-only APIs such as WIC metadata extraction, FileButler will implement equivalent output from Go-side parsers. The compatibility contract is the rendered rename plan for the same filename, flags, replacement text, file timestamps, and available metadata.

## Architecture

The existing `internal/rename` package remains the rename domain, but it will split into ordinary rename and PowerRename paths:

- Ordinary rename:
  - New API payload with `rootId`, `path`, and `newName`.
  - Backend validates exactly one source, validates `newName` as a basename, builds a one-item rename job, and reuses the existing job executor.
  - UI opens a compact dialog or prompt for the active pane selection.

- PowerRename:
  - Existing batch preview/job flow is renamed conceptually from `RenameDialog` to `PowerRenameDialog`.
  - The request options expand from the current simplified `RenameOptions` into `PowerRenameOptions`, preserving existing fields where names already match behavior.
  - A new PowerRename planner module owns token parsing, regex replacement, transforms, enumeration/random state, metadata extraction inputs, conflict detection, and natural ordering.

The UI will show both commands in the toolbar. `Rename` is disabled unless `activeSelection().length === 1`; `PowerRename` is disabled unless at least one item is selected.

## Data Flow

1. The user selects files or folders in the active pane.
2. `Rename` sends one item plus a new basename to the ordinary rename endpoint.
3. `PowerRename` opens a preview dialog and sends selected paths plus PowerRename options to the preview endpoint.
4. The backend resolves selected paths inside the configured root and gathers item metadata needed by PowerRename.
5. The planner returns a preview table with source path, old name, new name, target path, changed state, and conflict status.
6. Creating a job stores executable rename items and runs the existing rename executor.

## Compatibility Strategy

PowerRename compatibility will be protected by tests copied from observable PowerRename source behavior:

- Unit tests for regex replacement and replacement-group rewriting.
- Unit tests for simple search behavior with case sensitivity and match-all flags.
- Unit tests for target scope: name, extension, and full name.
- Unit tests for enumeration and random token parsing and rendering.
- Unit tests for output transforms.
- Unit tests for timestamp and metadata template rendering using controlled fixture metadata.
- Integration tests for conflict detection, duplicate target detection, and single-item ordinary rename validation.

Because FileButler runs on Linux as well as other hosts, tests will assert FileButler's compatibility layer output rather than depending on Windows APIs.

## Error Handling

Ordinary rename rejects:

- zero or multiple selected paths,
- empty names,
- names containing path separators,
- root escapes,
- target names that already exist.

PowerRename preview reports per-item conflicts without creating a job. Job creation rejects plans with conflicts. Invalid regex patterns and invalid token lengths return request errors with messages suitable for display in the dialog.

## UI And Localization

The toolbar will contain `Rename` and `PowerRename` as separate commands. Existing English and Simplified Chinese string tables will add labels for:

- `PowerRename`,
- ordinary rename title and new-name field,
- PowerRename-specific flags and preview errors,
- metadata/time/random/enumeration option labels where exposed in the dialog.

The current batch rename dialog becomes the PowerRename dialog and keeps localized modal labels.

## Non-Goals

- Recreating PowerToys WinUI layout pixel-for-pixel.
- Reproducing Windows Shell undo records, elevation prompts, or Explorer context-menu integration.
- Allowing operations outside configured FileButler roots.
