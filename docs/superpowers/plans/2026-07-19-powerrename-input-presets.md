# PowerRename Input Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit, focus-aware preset suggestions to the PowerRename Search and Replace inputs.

**Architecture:** Keep `RenameDialog` as the source of truth for `RenameOptions`, and add a small local `PresetInput` view helper for the two controlled text fields. The helper owns only focus, dismissal, and highlighted-option state; selecting a value calls the existing `update` path so the current preview effect and API contract remain unchanged.

**Tech Stack:** React 19, TypeScript, Base UI-backed `Input`, Tailwind utility classes, Vitest, Testing Library, and `user-event`.

---

### Task 1: Add failing interaction coverage

**Files:**
- Modify: `web/src/components/RenameDialog.test.tsx` after the existing PowerRename layout tests
- Test target: `web/src/components/RenameDialog.test.tsx`

- [ ] **Step 1: Add a test for empty/focused visibility, typing, and clearing**

Append this test:

```tsx
it("shows each preset only for an empty focused input", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(screen.queryByRole("option", { name: "^.*" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "${start=1,padding=3}" })).not.toBeInTheDocument();

  const search = screen.getByLabelText("Search");
  const replace = screen.getByLabelText("Replace");
  await userEvent.click(search);
  expect(screen.getByRole("option", { name: "^.*" })).toBeInTheDocument();

  await userEvent.type(search, "name");
  expect(screen.queryByRole("option", { name: "^.*" })).not.toBeInTheDocument();
  await userEvent.clear(search);
  expect(screen.getByRole("option", { name: "^.*" })).toBeInTheDocument();

  await userEvent.click(replace);
  expect(screen.getByRole("option", { name: "${start=1,padding=3}" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "^.*" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Add a test for pointer selection and blur behavior**

Append this test:

```tsx
it("fills and closes the selected preset without changing other options", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  const search = screen.getByLabelText("Search");
  await userEvent.click(search);
  await userEvent.click(screen.getByRole("option", { name: "^.*" }));

  expect(search).toHaveValue("^.*");
  expect(screen.queryByRole("option", { name: "^.*" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Use regular expressions")).not.toBeChecked();
  await waitFor(() => expect(api.renamePreview).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ search: "^.*", replace: "" }) })));

  await userEvent.clear(search);
  expect(screen.getByRole("option", { name: "^.*" })).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Use regular expressions"));
  expect(screen.queryByRole("option", { name: "^.*" })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Add a test for keyboard navigation and dismissal**

Append this test:

```tsx
it("supports keyboard preset selection and Escape dismissal", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  const replace = screen.getByLabelText("Replace");
  await userEvent.click(replace);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(replace).toHaveValue("${start=1,padding=3}");
  expect(screen.queryByRole("option", { name: "${start=1,padding=3}" })).not.toBeInTheDocument();

  await userEvent.clear(replace);
  expect(screen.getByRole("option", { name: "${start=1,padding=3}" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("option", { name: "${start=1,padding=3}" })).not.toBeInTheDocument();
  await userEvent.click(replace);
  expect(screen.getByRole("option", { name: "${start=1,padding=3}" })).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the focused tests and verify they fail for the missing listbox**

Run from `web/`:

```bash
npm test -- --run src/components/RenameDialog.test.tsx
```

Expected: the three new tests fail because the Search and Replace inputs do not render any `role="option"` elements yet; existing tests may continue to pass.

- [ ] **Step 5: Commit the red tests**

```bash
git add web/src/components/RenameDialog.test.tsx
git commit -m "test: cover PowerRename input presets"
```

### Task 2: Implement the focus-aware preset inputs

**Files:**
- Modify: `web/src/components/RenameDialog.tsx:1-13` for the keyboard-event type import and helper usage
- Modify: `web/src/components/RenameDialog.tsx:113-120` for the Search and Replace field markup
- Modify: `web/src/components/RenameDialog.tsx` after the existing `CheckOption` helper for `PresetInput`

- [ ] **Step 1: Add the two preset collections and replace the direct `Input` elements**

Import the keyboard event type at the top of the file:

```tsx
import { useEffect, useState, type KeyboardEvent } from "react";
```

Define these module-level constants beside `defaultRenameOptions`:

```tsx
const searchPresets = ["^.*"] as const;
const replacePresets = ["${start=1,padding=3}"] as const;
```

Give the existing labels stable IDs and pass the controlled values through `PresetInput`:

```tsx
<div className="grid gap-2">
  <Label id="rename-search-label" htmlFor="rename-search">{labels.search}</Label>
  <PresetInput
    id="rename-search"
    labelId="rename-search-label"
    value={options.search}
    presets={searchPresets}
    onChange={(value) => update({ search: value })}
  />
</div>
<div className="grid gap-2">
  <Label id="rename-replace-label" htmlFor="rename-replace">{labels.replace}</Label>
  <PresetInput
    id="rename-replace"
    labelId="rename-replace-label"
    value={options.replace}
    presets={replacePresets}
    onChange={(value) => update({ replace: value })}
  />
</div>
```

- [ ] **Step 2: Implement the controlled `PresetInput` state and rendering**

Add this helper below `CheckOption` (before any other standalone helper) and keep the parent `RenameOptions` state unchanged:

```tsx
type PresetInputProps = {
  id: string;
  labelId: string;
  value: string;
  presets: readonly string[];
  onChange(value: string): void;
};

function PresetInput({ id, labelId, value, presets, onChange }: PresetInputProps) {
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const listId = `${id}-presets`;
  const isOpen = focused && value.length === 0 && !dismissed && presets.length > 0;

  function selectPreset(preset: string) {
    onChange(preset);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (value.length > 0 || presets.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setDismissed(false);
      setHighlightedIndex((current) => (current + 1) % presets.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setDismissed(false);
      setHighlightedIndex((current) => (current <= 0 ? presets.length - 1 : current - 1));
      return;
    }
    if (event.key === "Enter" && isOpen && highlightedIndex >= 0) {
      event.preventDefault();
      selectPreset(presets[highlightedIndex]);
      return;
    }
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setDismissed(true);
      setHighlightedIndex(-1);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-labelledby={labelId}
        aria-activedescendant={isOpen && highlightedIndex >= 0 ? `${listId}-${highlightedIndex}` : undefined}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue);
          setHighlightedIndex(-1);
          if (nextValue.length === 0) setDismissed(false);
        }}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onClick={() => {
          if (value.length === 0) setDismissed(false);
        }}
        onBlur={() => {
          setFocused(false);
          setHighlightedIndex(-1);
        }}
        onKeyDown={handleKeyDown}
      />
      {isOpen ? (
        <div id={listId} role="listbox" aria-labelledby={labelId} className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {presets.map((preset, index) => (
            <button
              id={`${listId}-${index}`}
              key={preset}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              className={index === highlightedIndex ? "flex w-full items-center rounded-sm bg-accent px-2 py-1.5 text-left font-mono text-xs text-accent-foreground" : "flex w-full items-center rounded-sm px-2 py-1.5 text-left font-mono text-xs hover:bg-accent hover:text-accent-foreground"}
              onMouseDown={(event) => {
                event.preventDefault();
                selectPreset(preset);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {preset}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

The `onMouseDown` prevention keeps focus in the input long enough for pointer selection to update the controlled value. The value remains the only source of truth for whether text is present, while `dismissed` handles Escape without preventing a later click or clear from reopening the list.

- [ ] **Step 3: Run the focused tests and verify they pass**

Run:

```bash
npm test -- --run src/components/RenameDialog.test.tsx
```

Expected: all tests in `RenameDialog.test.tsx` pass, including the three preset tests, with no unhandled React warnings.

- [ ] **Step 4: Commit the implementation**

```bash
git add web/src/components/RenameDialog.tsx web/src/components/RenameDialog.test.tsx
git commit -m "feat: add PowerRename input presets"
```

### Task 3: Run the complete frontend verification

**Files:**
- Verify: `web/src/components/RenameDialog.tsx`
- Verify: `web/src/components/RenameDialog.test.tsx`
- Verify: `docs/superpowers/specs/2026-07-19-powerrename-input-presets-design.md`

- [ ] **Step 1: Run the complete frontend test suite**

From `web/` run:

```bash
npm test -- --run
```

Expected: Vitest exits with code 0 and reports zero failed tests.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: ESLint exits with code 0 and reports no errors.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: TypeScript compilation and Vite bundling both complete with exit code 0.

- [ ] **Step 4: Inspect the final diff and working tree**

```bash
git diff HEAD~1 --check
git status --short
git log -3 --oneline
```

Expected: no whitespace errors, only the intended PowerRename files changed after the implementation commit, and the implementation commit is at `HEAD`.
