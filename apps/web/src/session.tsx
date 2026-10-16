import { createContext, useContext } from "react";
import type { JsonRecord } from "../../../packages/api-client";
export const SessionContext = createContext<{
  user: JsonRecord | null;
  permissions: string[];
  team: string;
  en?: boolean;
}>({ user: null, permissions: [], team: "" });

export function useText() {
  const { en } = useContext(SessionContext);
  return (zh: string, english: string) => (en ? english : zh);
}
