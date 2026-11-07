import { useSyncExternalStore } from "react";

export const mobileViewportQuery = "(max-width: 767px)";
const coarsePointerQuery = "(pointer: coarse)";

// Presentation only: never writes the user's desktop/compact mode preference.
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const media = window.matchMedia(query);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

export function useWorkspaceViewport() {
  const mobile = useMediaQuery(mobileViewportQuery);
  const coarsePointer = useMediaQuery(coarsePointerQuery);
  return { mobile, coarsePointer };
}
