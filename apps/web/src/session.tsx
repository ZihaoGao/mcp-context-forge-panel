import { createContext } from "react";
import type { JsonRecord } from "../../../packages/api-client";
export const SessionContext = createContext<{
  user: JsonRecord | null;
  permissions: string[];
  team: string;
}>({ user: null, permissions: [], team: "" });
