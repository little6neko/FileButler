# Input Underscore and PowerRename Scrolling Implementation Plan

**Goal:** Keep underscore glyphs visible in compact inputs and make PowerRename horizontal overflow directly draggable at the visible bottom of its preview viewport.

**Architecture:** Adjust the shared input's internal vertical metrics without changing its outer dimensions. Extend the shared table wrapper with an optional container-class hook, then make the PowerRename preview body the only native two-axis scroll owner. Do not add custom wheel, touch, pointer, or middle-button event handling.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, shadcn/Base UI components, Testing Library, Vitest, Playwright Chromium.

---

### Task 1: Protect Compact Input Glyphs From Vertical Clipping

**Files:**
- Modify: `web/src/components/ui/input.tsx`
- Test: `web/src/components/ui-foundation.test.tsx`

- [ ] Add a shared-input regression test that renders an underscore-containing value and asserts the compact height, zero vertical padding, and explicit line height.
- [ ] Run the focused test and confirm it fails against the existing `py-1` input style.
- [ ] Replace vertical padding with `py-0` and add `leading-5`, retaining `h-8`, horizontal padding, responsive font size, and all state styles.
- [ ] Run the focused UI-foundation tests.

### Task 2: Give PowerRename One Native Two-Axis Scroll Owner

**Files:**
- Modify: `web/src/components/ui/table.tsx`
- Modify: `web/src/components/RenameDialog.tsx`
- Test: `web/src/components/ui-foundation.test.tsx`
- Test: `web/src/components/RenameDialog.test.tsx`

- [ ] Add tests proving that `Table` keeps `overflow-x-auto` by default and accepts an isolated container-class override.
- [ ] Add a PowerRename test proving that the visible preview body owns `overflow-auto` and its nested table wrapper uses visible overflow.
- [ ] Run the focused tests and confirm they fail before implementation.
- [ ] Add an optional `containerClassName` prop to `Table`, merged after its default wrapper classes.
- [ ] Mark the PowerRename preview body as the scroll viewport and set its table wrapper to `overflow-visible`; retain non-wrapping table cells.
- [ ] Do not attach wheel, touch, pointer, drag, or middle-button handlers, preserving browser-native two-axis scrolling.
- [ ] Run the focused table and PowerRename tests.

### Task 3: Browser and Full-Suite Verification

**Files:**
- Verify: `web/src/components/ui/input.tsx`
- Verify: `web/src/components/ui/table.tsx`
- Verify: `web/src/components/RenameDialog.tsx`

- [ ] Run all frontend unit tests.
- [ ] Run frontend lint and the production build.
- [ ] Render `a_b_c.txt` in the shared input under Chromium and verify the DOM value and visible underscore.
- [ ] Render PowerRename with long old and new names and verify the preview viewport has `scrollWidth > clientWidth`.
- [ ] Set and read back the viewport's horizontal `scrollLeft` to verify native horizontal movement.
- [ ] Verify short names do not produce horizontal overflow.
- [ ] Check `git diff --check` and review the final diff for unrelated changes.
