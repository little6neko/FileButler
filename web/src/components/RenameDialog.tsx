import { useEffect, useState, type KeyboardEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "../api/client";
import type { PlanItem, RenameOptions } from "../api/types";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  rootId: string;
  paths: string[];
  initialOptions?: RenameOptions;
  onOptionsCommitted?(options: RenameOptions): void;
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

const defaultRenameOptions: RenameOptions = {
  search: "",
  replace: "",
  useRegex: false,
  caseSensitive: false,
  matchAll: true,
  target: "name",
  includeFiles: true,
  includeDirs: true,
  includeSubfolders: false,
  enumerate: false,
  nameOnly: true,
  extensionOnly: false,
  fullName: false,
  excludeFiles: false,
  excludeFolders: false,
  excludeSubfolders: true,
  uppercase: false,
  lowercase: false,
  titlecase: false,
  capitalized: false,
  enumerateItems: false,
  randomizeItems: false,
};

const searchPresets = ["^.*"] as const;
const replacePresets = ["${start=1,padding=3}"] as const;

export function RenameDialog({
  rootId,
  paths,
  initialOptions,
  onOptionsCommitted,
  onJobCreated,
  onClose,
  labels = strings.en,
}: Props) {
  const [options, setOptions] = useState<RenameOptions>(() => ({ ...(initialOptions ?? defaultRenameOptions) }));
  const [items, setItems] = useState<PlanItem[]>([]);
  const [hasConflict, setHasConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .renamePreview({ rootId, paths, options })
      .then((plan) => {
        if (!active) return;
        setItems(plan.items);
        setHasConflict(plan.hasConflict);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : labels.previewFailed);
      });
    return () => {
      active = false;
    };
  }, [labels.previewFailed, rootId, paths, options]);

  async function run() {
    setSubmitting(true);
    setError(null);
    try {
      const job = await api.renameCreateJob({ rootId, paths, options });
      onOptionsCommitted?.({ ...options });
      onJobCreated(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.renameFailed);
    } finally {
      setSubmitting(false);
    }
  }

  const changedCount = items.filter((item) => item.changed).length;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="flex h-[min(760px,90vh)] flex-col sm:max-w-6xl"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="sr-only">{labels.renameDialog}</DialogTitle>
          <h2 className="font-heading text-base leading-none font-medium">{labels.powerRename}</h2>
          <DialogDescription>{labels.renamePreviewSummary(changedCount, items.length)}</DialogDescription>
        </DialogHeader>
        <ErrorBanner message={error} />
        <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-4">
          <section data-testid="rename-options-column" className="min-h-0 space-y-4 overflow-auto border-r pr-4">
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
            <div className="grid grid-cols-2 gap-3">
              <CheckOption id="rename-regex" checked={options.useRegex} label={labels.useRegularExpressions} onCheckedChange={(checked) => update({ useRegex: checked })} />
              <CheckOption id="rename-case" checked={options.caseSensitive} label={labels.caseSensitive} onCheckedChange={(checked) => update({ caseSensitive: checked })} />
              <CheckOption id="rename-all" checked={options.matchAll} label={labels.matchAllOccurrences} onCheckedChange={(checked) => update({ matchAll: checked })} />
            </div>
            <fieldset className="grid gap-3 rounded-md border p-3">
              <legend className="px-1 text-xs font-semibold">{labels.target}</legend>
              <CheckOption id="rename-name" checked={options.nameOnly} label={labels.nameOnly} onCheckedChange={(checked) => setTargetMode("name", checked)} />
              <CheckOption id="rename-extension" checked={options.extensionOnly} label={labels.extensionOnly} onCheckedChange={(checked) => setTargetMode("extension", checked)} />
              <CheckOption id="rename-full" checked={options.fullName} label={labels.fullName} onCheckedChange={(checked) => setTargetMode("both", checked)} />
            </fieldset>
            <fieldset className="grid grid-cols-2 gap-3 rounded-md border p-3">
              <legend className="px-1 text-xs font-semibold">{labels.textTransform}</legend>
              <CheckOption id="rename-uppercase" checked={options.uppercase} label={labels.uppercase} onCheckedChange={(checked) => setTransform("uppercase", checked)} />
              <CheckOption id="rename-lowercase" checked={options.lowercase} label={labels.lowercase} onCheckedChange={(checked) => setTransform("lowercase", checked)} />
              <CheckOption id="rename-titlecase" checked={options.titlecase} label={labels.titlecase} onCheckedChange={(checked) => setTransform("titlecase", checked)} />
              <CheckOption id="rename-capitalized" checked={options.capitalized} label={labels.capitalized} onCheckedChange={(checked) => setTransform("capitalized", checked)} />
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <CheckOption id="rename-exclude-files" checked={options.excludeFiles} label={labels.excludeFiles} onCheckedChange={(checked) => update({ excludeFiles: checked, includeFiles: !checked })} />
              <CheckOption id="rename-exclude-folders" checked={options.excludeFolders} label={labels.excludeFolders} onCheckedChange={(checked) => update({ excludeFolders: checked, includeDirs: !checked })} />
              <CheckOption id="rename-exclude-subfolders" checked={options.excludeSubfolders} label={labels.excludeSubfolders} onCheckedChange={(checked) => update({ excludeSubfolders: checked, includeSubfolders: !checked })} />
              <CheckOption id="rename-enumerate" checked={options.enumerateItems} label={labels.enumerateItems} onCheckedChange={(checked) => update({ enumerateItems: checked, enumerate: checked })} />
              <CheckOption id="rename-randomize" checked={options.randomizeItems} label={labels.randomizeItems} onCheckedChange={(checked) => update({ randomizeItems: checked })} />
            </div>
          </section>
          <section data-testid="rename-preview-column" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border">
            <div className="border-b bg-muted/40 px-3 py-2">
              <p className="text-xs font-semibold">{labels.livePreview}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-xs">{labels.old}</TableHead>
                    <TableHead className="h-8 text-xs">{labels.new}</TableHead>
                    <TableHead className="h-8 text-xs">{labels.status}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.sourcePath} className={item.changed ? "bg-blue-50" : undefined}>
                      <TableCell className="py-1.5 text-xs">{item.oldName}</TableCell>
                      <TableCell className={item.changed ? "py-1.5 text-xs font-medium text-blue-700" : "py-1.5 text-xs"}>{item.newName}</TableCell>
                      <TableCell className={item.conflict ? "py-1.5 text-xs text-destructive" : "py-1.5 text-xs text-emerald-700"}>
                        {item.conflict ? item.errorText || item.errorCode : labels.ready}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
          <Button onClick={run} disabled={hasConflict || submitting}>
            {submitting ? <LoaderCircle className="animate-spin" /> : null}
            {labels.renameItems(paths.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  function update(partial: Partial<RenameOptions>) {
    setOptions((current) => ({ ...current, ...partial }));
  }

  function setTargetMode(target: RenameOptions["target"], checked: boolean) {
    if (!checked) {
      update({ target: "name", nameOnly: true, extensionOnly: false, fullName: false });
      return;
    }
    update({
      target,
      nameOnly: target === "name",
      extensionOnly: target === "extension",
      fullName: target === "both",
    });
  }

  function setTransform(transform: "uppercase" | "lowercase" | "titlecase" | "capitalized", checked: boolean) {
    update({
      uppercase: checked && transform === "uppercase",
      lowercase: checked && transform === "lowercase",
      titlecase: checked && transform === "titlecase",
      capitalized: checked && transform === "capitalized",
    });
  }
}

function CheckOption({
  id,
  checked,
  label,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  label: string;
  onCheckedChange(checked: boolean): void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        nativeButton
        render={<button type="button" />}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <Label htmlFor={id} className="text-xs font-normal">{label}</Label>
    </div>
  );
}

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
              tabIndex={-1}
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
