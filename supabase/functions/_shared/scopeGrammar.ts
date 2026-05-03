/**
 * Scope grammar for the External Agent Write API.
 *
 * Pure TypeScript — no Deno or Supabase imports. Safe to test under Node or Deno.
 *
 * Grammar (v1):
 *   events:{action}:{target}
 *     action  ∈ {read, write}
 *     target  ∈ {all} | vehicle:{VIN}
 *
 * Examples:
 *   events:write:all                        → write to any vehicle the user owns
 *   events:write:vehicle:6F07C219593         → write only to that VIN
 *   events:read:vehicle:6F07C219593          → read-back for that VIN
 *   events:read:all                          → read-back for any vehicle
 *
 * Legacy scopes (kept for backward compat with existing API keys):
 *   write   → equivalent to events:write:all for events:* requests
 *   read    → equivalent to events:read:all  for events:* requests
 *   admin   → matches everything
 *
 * VIN normalization: uppercase, no whitespace. VIN comparison is case-insensitive.
 */

export interface ScopeRequest {
  resource: 'events';
  action: 'read' | 'write';
  target: 'vehicle';
  targetId: string; // VIN
}

export type ParsedScope =
  | { kind: 'legacy'; legacy: 'read' | 'write' | 'admin' }
  | { kind: 'all'; resource: 'events'; action: 'read' | 'write' }
  | {
      kind: 'vehicle';
      resource: 'events';
      action: 'read' | 'write';
      vin: string; // normalized uppercase
    };

const LEGACY: ReadonlySet<string> = new Set(['read', 'write', 'admin']);

function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase();
}

/**
 * Parse a scope string into a structured form. Returns null if malformed.
 *
 * Accepts:
 *   - legacy strings: "read", "write", "admin"
 *   - "events:read:all" / "events:write:all"
 *   - "events:read:vehicle:{VIN}" / "events:write:vehicle:{VIN}"
 */
export function parseScope(s: string | null | undefined): ParsedScope | null {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;

  if (LEGACY.has(trimmed)) {
    return { kind: 'legacy', legacy: trimmed as 'read' | 'write' | 'admin' };
  }

  const parts = trimmed.split(':');
  // events:{action}:all  → 3 parts
  // events:{action}:vehicle:{VIN}  → 4 parts
  if (parts.length < 3) return null;
  if (parts[0] !== 'events') return null;

  const action = parts[1];
  if (action !== 'read' && action !== 'write') return null;

  const target = parts[2];

  if (target === 'all') {
    if (parts.length !== 3) return null;
    return { kind: 'all', resource: 'events', action };
  }

  if (target === 'vehicle') {
    if (parts.length !== 4) return null;
    const vin = parts[3];
    if (!vin || vin.length === 0) return null;
    return {
      kind: 'vehicle',
      resource: 'events',
      action,
      vin: normalizeVin(vin),
    };
  }

  return null;
}

/**
 * Return the VIN component of a scope string, or null if the scope is not
 * vehicle-targeted (legacy scopes, "all", or malformed scopes return null).
 */
export function vinFromScope(s: string | null | undefined): string | null {
  const parsed = parseScope(s);
  if (!parsed) return null;
  if (parsed.kind === 'vehicle') return parsed.vin;
  return null;
}

/**
 * Check whether any granted scope authorizes the requested action.
 *
 * Rules:
 *   - admin matches everything
 *   - legacy "write" matches any events:write:* request
 *   - legacy "read"  matches any events:read:*  request
 *   - events:{action}:all matches any VIN for that action
 *   - events:{action}:vehicle:{VIN} matches only that VIN (case-insensitive) for that action
 *   - read scopes never authorize write requests
 *   - write scopes do NOT implicitly authorize read (be explicit; cheap to add)
 *
 * Granted scopes that fail to parse are silently ignored — they cannot
 * accidentally authorize a request.
 */
export function scopeMatches(
  granted: readonly string[] | null | undefined,
  request: ScopeRequest,
): boolean {
  if (!granted || granted.length === 0) return false;
  if (request.resource !== 'events') return false;
  if (request.action !== 'read' && request.action !== 'write') return false;
  if (request.target !== 'vehicle') return false;
  if (!request.targetId) return false;

  const wantedVin = normalizeVin(request.targetId);

  for (const raw of granted) {
    const parsed = parseScope(raw);
    if (!parsed) continue;

    if (parsed.kind === 'legacy') {
      if (parsed.legacy === 'admin') return true;
      if (parsed.legacy === 'write' && request.action === 'write') return true;
      if (parsed.legacy === 'read' && request.action === 'read') return true;
      continue;
    }

    if (parsed.resource !== 'events') continue;
    if (parsed.action !== request.action) continue;

    if (parsed.kind === 'all') return true;
    if (parsed.kind === 'vehicle' && parsed.vin === wantedVin) return true;
  }

  return false;
}
