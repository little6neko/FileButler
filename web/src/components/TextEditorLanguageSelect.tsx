import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { UIStrings } from "../i18n";
import type { TextLanguageSelection } from "../textEditorSession";
import {
  textLanguageDefinition,
  textLanguageOptions,
  type TextLanguage,
} from "../textFiles";

type Props = {
  selection: TextLanguageSelection;
  automaticLanguage: TextLanguage;
  requestedLanguage: TextLanguage;
  loading: boolean;
  largeFileLocked: boolean;
  unavailable: boolean;
  labels: UIStrings;
  onChange(selection: TextLanguageSelection): void;
};

export function TextEditorLanguageSelect({
  selection,
  automaticLanguage,
  requestedLanguage,
  loading,
  largeFileLocked,
  unavailable,
  labels,
  onChange,
}: Props) {
  const automaticLabel = labels.editorSyntaxAuto(textLanguageDefinition(automaticLanguage).displayName);
  const items = [
    { value: "auto", label: automaticLabel },
    ...textLanguageOptions().map(({ id, displayName }) => ({ value: id, label: displayName })),
  ];
  const selectedLabel = selection === "auto"
    ? automaticLabel
    : textLanguageDefinition(selection).displayName;
  const triggerLabel = largeFileLocked
    ? labels.editorSyntaxLargeFile
    : loading
      ? labels.editorSyntaxLoading(textLanguageDefinition(requestedLanguage).displayName)
      : selectedLabel;
  const disabled = unavailable || loading || largeFileLocked;

  return (
    <Select
      items={items}
      value={selection}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onChange(next as TextLanguageSelection);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={labels.editorSyntaxHighlight}
        aria-busy={loading || undefined}
        title={triggerLabel}
        className="text-editor-language-trigger"
      >
        <span className="text-editor-language-value">{triggerLabel}</span>
      </SelectTrigger>
      <SelectContent
        align="end"
        alignItemWithTrigger={false}
        className="text-editor-language-menu"
      >
        <SelectItem value="auto">{automaticLabel}</SelectItem>
        {textLanguageOptions().map(({ id, displayName }) => (
          <SelectItem key={id} value={id}>{displayName}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
