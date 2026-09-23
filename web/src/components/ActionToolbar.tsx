import { Fragment } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { UIStrings } from "../i18n";
import type { FileAction, FileContextAction } from "./fileActions";
import { MenuRoot, MenuTrigger, MenuPortal, MenuPositioner, MenuPopup } from "./ui/menu";
import { FileActionMenuItems } from "./FileActionMenuItems";

type Props = {
  actions: FileAction[];
  selectedCount: number;
  labels: UIStrings;
  moreActions?: FileContextAction[];
  disabled?: boolean;
};

export function ActionToolbar({ actions, selectedCount, labels, moreActions = [], disabled = false }: Props) {
  const hiddenActions: FileContextAction[] = [];
  let boundary = false;
  for (const action of moreActions) {
    boundary ||= Boolean(action.separatorBefore);
    if (actions.some((shown) => shown.id === action.id)) continue;
    hiddenActions.push({ ...action, separatorBefore: hiddenActions.length > 0 && boundary });
    boundary = false;
  }
  return (
    <nav aria-label={labels.fileActions} className="flex h-[42px] items-center gap-1.5 border-b bg-slate-50 px-3">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Fragment key={action.id}>
            {action.id === "delete" && hiddenActions.length > 0 ? <>
              <Separator orientation="vertical" className="mx-1 h-5" />
              <MenuRoot><MenuTrigger disabled={disabled} render={<Button size="sm" variant="outline" aria-label={labels.moreActions} data-action-id="more" />}><Ellipsis /><span className="action-label">{labels.moreActions}</span></MenuTrigger>
                <MenuPortal><MenuPositioner align="start" sideOffset={4}><MenuPopup aria-label={labels.moreActions}><FileActionMenuItems actions={hiddenActions} /></MenuPopup></MenuPositioner></MenuPortal>
              </MenuRoot>
            </> : null}
            {action.separatorBefore ? <Separator orientation="vertical" className="mx-1 h-5" /> : null}
            <Button
              size="sm"
              variant="outline"
              aria-label={action.label}
              data-action-id={action.id}
              className={action.destructive ? "text-destructive hover:text-destructive" : undefined}
              onClick={action.run}
              disabled={disabled || action.disabled}
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
