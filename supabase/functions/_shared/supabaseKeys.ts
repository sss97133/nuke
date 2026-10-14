/**
 * supabaseKeys — the project's API keys for edge-function code.
 *
 * The platform injects the new keys as JSON maps keyed by key name (`SUPABASE_SECRET_KEYS`,
 * `SUPABASE_PUBLISHABLE_KEYS`) beside the legacy names (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`).
 * Docs: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys (step 4).
 *
 * The secret key a function sends (projectSecretKey), in order:
 *   1. the secret key named `functions` in SUPABASE_SECRET_KEYS, when the owner creates one (a key only edge
 *      functions hold, so it can be rotated alone);
 *   2. SUPABASE_SERVICE_ROLE_KEY when the platform puts a secret key there (`sb_secret_…`): measured 2026-10-14, it
 *      is what every deployed function sends, and the only key a function still on the old writeGuard accepts;
 *   3. the secret key named `default`;
 *   4. SUPABASE_SERVICE_ROLE_KEY as it is (a legacy JWT outside this project; refused here since 2026-10-14).
 * The user-set secrets SERVICE_ROLE_KEY, JWT_SIGNING_SECRET, VITE_SUPABASE_JWT_SECRET and
 * VITE_SUPABASE_SERVICE_ROLE_KEY held the legacy service key and JWT secret, both public; they were deleted on
 * 2026-10-14 and nothing here reads them.
 *
 * The new keys travel on the `apikey` header, where supabase-js puts them. A function receives a secret key as the
 * caller sent it, on `Authorization: Bearer` or on `apikey` (measured 2026-10-14), and writeGuard accepts either.
 */

type Env = (name: string) => string | undefined;

const denoEnv: Env = (name) => Deno.env.get(name);

function namedKeys(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const keys: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) keys[name] = value;
    }
    return keys;
  } catch {
    return {};
  }
}

const isJwt = (value: string) => value.split(".").length === 3;

/** Every secret key the platform injects, by name. Empty until the project has secret keys. */
export function secretKeys(env: Env = denoEnv): Record<string, string> {
  return namedKeys(env("SUPABASE_SECRET_KEYS"));
}

/**
 * Every secret key a caller may present: each one in SUPABASE_SECRET_KEYS (the guide puts every secret key there under
 * its own name, and each one is a service credential), and the platform's SUPABASE_SERVICE_ROLE_KEY when it is not a
 * JWT. A legacy JWT is never in this list: the legacy service key is public.
 */
export function knownSecretKeys(env: Env = denoEnv): string[] {
  const keys = new Set(Object.values(secretKeys(env)));
  const injected = env("SUPABASE_SERVICE_ROLE_KEY");
  if (injected && !isJwt(injected)) keys.add(injected);
  return [...keys];
}

/** The secret key this function sends, in the order in the header. */
export function projectSecretKey(env: Env = denoEnv): string | undefined {
  const named = secretKeys(env);
  const injected = env("SUPABASE_SERVICE_ROLE_KEY");
  return named["functions"] ?? (injected?.startsWith("sb_secret_") ? injected : undefined) ?? named["default"] ??
    injected;
}

/** The public client key: the publishable key the platform injects, else the `default` one, else the legacy env. */
export function projectPublishableKey(env: Env = denoEnv): string | undefined {
  const injected = env("SUPABASE_ANON_KEY");
  if (injected?.startsWith("sb_publishable_")) return injected;
  return namedKeys(env("SUPABASE_PUBLISHABLE_KEYS"))["default"] ?? injected ?? env("ANON_KEY");
}
