import { Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { MenuItem, MenuPopup, MenuPortal, MenuPositioner, MenuRoot, MenuSeparator, MenuTrigger } from "./ui/menu";

type Props = {
  label: string;
  name: string;
  value: string;
  items: { id: string; name: string }[];
  disabled?: boolean;
  message?: string;
  onOpen?(): void;
  onSelect(id: string): void;
  add?: { label: string; run(): void };
};

export function LocationMenu({ label, name, value, items, disabled, message, onOpen, onSelect, add }: Props) {
  return <MenuRoot onOpenChange={(open) => { if (open) onOpen?.(); }}>
    <MenuTrigger disabled={disabled} render={<Button size="sm" variant="outline" className="pane-location-trigger" aria-label={label} title={name} />}>
      <span className="truncate">{name}</span><ChevronDown className="size-3.5 shrink-0" />
    </MenuTrigger>
    <MenuPortal><MenuPositioner className="z-50" align="start" sideOffset={4}><MenuPopup aria-label={label} className="pane-location-menu">
      {items.map((item) => <MenuItem key={item.id} title={item.name} className="file-action-menu-item" aria-current={item.id === value ? "true" : undefined} onClick={() => { if (item.id !== value) onSelect(item.id); }}>
        <Check aria-hidden="true" className={`size-3.5 shrink-0${item.id === value ? "" : " invisible"}`} /><span className="truncate">{item.name}</span>
      </MenuItem>)}
      {message ? <MenuItem disabled className="file-action-menu-item">{message}</MenuItem> : null}
      {add ? <><MenuSeparator className="file-action-menu-separator" /><MenuItem className="file-action-menu-item" onClick={add.run}><Plus aria-hidden="true" className="size-3.5" />{add.label}</MenuItem></> : null}
    </MenuPopup></MenuPositioner></MenuPortal>
  </MenuRoot>;
}
