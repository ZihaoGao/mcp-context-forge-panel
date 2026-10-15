import { randomBytes } from "node:crypto";
// Separators prevent random UUID substrings from violating the backend's
// three-sequential-character policy, while preserving generated entropy.
export function fixturePassword() {
  return "Q9!v." + [...randomBytes(18).toString("base64url")].join(".");
}
