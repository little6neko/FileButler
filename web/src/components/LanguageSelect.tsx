import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LanguageMode, UIStrings } from "../i18n";

export function LanguageSelect({ value, onChange, labels }: { value: LanguageMode; onChange(value: LanguageMode): void; labels: UIStrings }) {
  const items = [
    { value: "auto", label: labels.languageAuto },
    { value: "en", label: labels.languageEnglish },
    { value: "zh-CN", label: labels.languageChinese },
  ];

  return (
    <Select items={items} value={value} onValueChange={(next) => onChange(next as LanguageMode)}>
      <SelectTrigger aria-label="Language" className="h-7 w-[118px] bg-slate-50 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">{labels.languageAuto}</SelectItem>
        <SelectItem value="en">{labels.languageEnglish}</SelectItem>
        <SelectItem value="zh-CN">{labels.languageChinese}</SelectItem>
      </SelectContent>
    </Select>
  );
}
