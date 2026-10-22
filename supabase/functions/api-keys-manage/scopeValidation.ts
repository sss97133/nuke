import { parseScope } from "../_shared/scopeGrammar.ts";

const SELF_SERVICE_SCOPES = new Set([
  "read", "write", "stage_write", "write:observations", "mcp:tools",
  "accounting:read", "accounting:correct",
]);

/** Issuance ceiling, not resource authorization. Existing keys are unaffected. */
export function validateSelfServiceScopes(input: unknown): string[] {
  if (input === undefined) return ["read", "write"];
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
    throw new Error("Scopes must be a nonempty array of at most 100 supported scopes");
  }
  for (const scope of input) {
    if (typeof scope !== "string" || scope.length > 200 || scope !== scope.trim()) {
      throw new Error("Unsupported self-service API key scope");
    }
    if (SELF_SERVICE_SCOPES.has(scope)) continue;
    const parsed = parseScope(scope);
    if (parsed?.kind === "all") continue;
    // Classic vehicle identifiers may be shorter than modern 17-character VINs.
    if (parsed?.kind === "vehicle" && /^[A-Za-z0-9-]{1,64}$/.test(scope.split(":")[3])) continue;
    throw new Error("Unsupported self-service API key scope");
  }
  return [...new Set(input)];
}
