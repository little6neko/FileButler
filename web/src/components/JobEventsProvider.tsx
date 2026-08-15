import { useEffect, useState, type ReactNode } from "react";
import { JobEventsStore, type EventSourceFactory } from "../jobEvents";
import { JobEventsContext } from "../jobEventsContext";

export function JobEventsProvider({ children, eventSourceFactory }: { children: ReactNode; eventSourceFactory?: EventSourceFactory }) {
  const [store] = useState(() => new JobEventsStore(eventSourceFactory));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return <JobEventsContext.Provider value={store}>{children}</JobEventsContext.Provider>;
}
