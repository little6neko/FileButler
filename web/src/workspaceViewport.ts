import { useEffect, useSyncExternalStore } from "react";

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

// Safari's keyboard can shrink the visual viewport without changing layout height.
export function useMobileViewportHeight() {
  const mobile = useMediaQuery(mobileViewportQuery);
  useEffect(() => {
    if (!mobile) return;
    const viewport = window.visualViewport;
    const update = () => document.documentElement.style.setProperty("--mobile-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    update();
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--mobile-viewport-height");
    };
  }, [mobile]);
}
