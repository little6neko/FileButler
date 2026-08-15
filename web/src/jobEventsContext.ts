import { createContext, useContext } from "react";
import { JobEventsStore } from "./jobEvents";

export const JobEventsContext = createContext<JobEventsStore | null>(null);

export function useJobEventsStore() {
  const store = useContext(JobEventsContext);
  if (!store) throw new Error("JobEventsProvider is required");
  return store;
}

export function useOptionalJobEventsStore() {
  return useContext(JobEventsContext);
}
