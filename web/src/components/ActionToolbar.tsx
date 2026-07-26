import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { UIStrings } from "../i18n";
import type { FileAction } from "./fileActions";

type Props = {
  actions: FileAction[];
  selectedCount: number;
  labels: UIStrings;
};

export function ActionToolbar({ actions, selectedCount, labels }: Props) {
  return (
    <nav aria-label={labels.fileActions} className="flex h-[42px] items-center gap-1.5 border-b bg-slate-50 px-3">
      {actions.map((action, index) => {
        const Icon = action.icon;
        return (
          <Fragment key={action.id}>
            {action.separatorBefore ? <Separator orientation="vertical" className="mx-1 h-5" /> : null}
            <Button
              size="sm"
              variant={index === 0 ? "default" : action.destructive ? "ghost" : "outline"}
              aria-label={action.label}
              data-action-id={action.id}
              className={action.destructive ? "text-destructive hover:text-destructive" : undefined}
              onClick={action.run}
              disabled={action.disabled}
            >
              <Icon /><span className="action-label">{action.label}</span>
            </Button>
          </Fragment>
        );
      })}
      <span className="ml-auto text-xs text-slate-500">{labels.selectionSummary(selectedCount)}</span>
    </nav>
  );
}
