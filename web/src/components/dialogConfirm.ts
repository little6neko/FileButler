import type { KeyboardEvent } from "react";

const specificControlSelector = [
  "button",
  "a[href]",
  "select",
  "textarea",
  "input[type='button']",
  "input[type='checkbox']",
  "input[type='radio']",
  "input[type='reset']",
  "input[type='submit']",
  "[role='button']",
  "[role='checkbox']",
  "[role='link']",
  "[role='option']",
  "[role='radio']",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");

export function confirmDialogOnEnter(
  event: KeyboardEvent<HTMLElement>,
  enabled: boolean,
  confirm: () => void,
) {
  if (
    !enabled ||
    event.key !== "Enter" ||
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.repeat
  ) {
    return;
  }

  const target = event.target;
  if (target instanceof Element && target.closest(specificControlSelector)) return;

  event.preventDefault();
  confirm();
}
