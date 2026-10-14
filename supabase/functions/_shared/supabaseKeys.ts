/**
 * supabaseKeys — the project's API keys for edge-function code.
 *
 * The platform injects the new keys as JSON maps keyed by key name (`SUPABASE_SECRET_KEYS`,
 * `SUPABASE_PUBLISHABLE_KEYS`) beside the legacy names (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`).
 * Docs: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys (step 4).
 *
 * Measured 2026-10-14 (edge logs, the 12 hours before the legacy keys were disabled at 05:28Z): what this
 * project's functions read from SUPABASE_SERVICE_ROLE_KEY is already a secret key (`sb_secret_…`; ~650k function
 * requests used one, 791 used a legacy JWT). User-set secrets such as SERVICE_ROLE_KEY still hold legacy JWTs,
 * which the platform refuses since the switch. So every read goes through here, in this order:
 *   1. the legacy name, when the platform already puts a new key there (what functions send today, unchanged);
 *   2. the `default` key from the JSON map;
 *   3. the legacy env, JWT or not (refused by the platform since 2026-10-14; kept for other environments).
 *
 * The new keys travel on the `apikey` header, where supabase-js puts them. On a call to another edge function, the
 * gateway replaces a secret key on `Authorization: Bearer` with a JWT it mints (request header
 * sb-api-key-compatibility: minted), which writeGuard verifies against the project JWKS.
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

/** Every secret key the platform injects, by name. Empty until the project has secret keys. */
export function secretKeys(env: Env = denoEnv): Record<string, string> {
  return namedKeys(env("SUPABASE_SECRET_KEYS"));
}

/**
 * Every opaque service key this function holds: the named secret keys, and a legacy-named env value that is
 * not a JWT (the platform puts a secret key there). A legacy JWT is never in this list: the legacy service key
 * is public, and only the platform can say whether it is still accepted.
 */
export function knownSecretKeys(env: Env = denoEnv): string[] {
  const keys = new Set(Object.values(secretKeys(env)));
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"]) {
    const value = env(name);
    if (value && value.split(".").length !== 3) keys.add(value);
  }
  return [...keys];
}

/** The server-side key: the secret key the platform injects, else the `default` secret key, else the legacy env. */
export function projectSecretKey(env: Env = denoEnv): string | undefined {
  const injected = env("SUPABASE_SERVICE_ROLE_KEY");
  if (injected?.startsWith("sb_secret_")) return injected;
  return secretKeys(env)["default"] ?? injected ?? env("SERVICE_ROLE_KEY");
}

/** The public client key: the publishable key the platform injects, else the `default` one, else the legacy env. */
export function projectPublishableKey(env: Env = denoEnv): string | undefined {
  const injected = env("SUPABASE_ANON_KEY");
  if (injected?.startsWith("sb_publishable_")) return injected;
  return namedKeys(env("SUPABASE_PUBLISHABLE_KEYS"))["default"] ?? injected ?? env("ANON_KEY");
}
