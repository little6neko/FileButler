import { useEffect, useState, type ReactNode } from "react";
import { JobEventsStore, type EventSourceFactory } from "../jobEvents";
import { JobEventsContext } from "../jobEventsContext";
import { TransferProgressWindows } from "./TransferProgress";
import { strings, type UIStrings } from "../i18n";

export function JobEventsProvider({ children, eventSourceFactory, labels = strings.en }: { children: ReactNode; eventSourceFactory?: EventSourceFactory; labels?: UIStrings }) {
  const [store] = useState(() => new JobEventsStore(eventSourceFactory));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return <JobEventsContext.Provider value={store}>{children}<TransferProgressWindows store={store} labels={labels} /></JobEventsContext.Provider>;
}
