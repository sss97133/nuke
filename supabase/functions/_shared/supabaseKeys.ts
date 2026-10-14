/**
 * supabaseKeys — the project's API keys for edge-function code.
 *
 * The platform injects the new keys as JSON maps keyed by key name (`SUPABASE_SECRET_KEYS`,
 * `SUPABASE_PUBLISHABLE_KEYS`) beside the legacy JWT keys (`SUPABASE_SERVICE_ROLE_KEY`,
 * `SUPABASE_ANON_KEY`). The legacy keys stop working once they are disabled in the dashboard, and
 * the platform keeps injecting their old values, so every read goes through here: the `default` new
 * key first, the legacy env as fallback while it still exists.
 * Docs: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys (step 4).
 *
 * The new keys travel on the `apikey` header. supabase-js and PostgREST accept them as the client key;
 * a call to another edge function should send the secret key as `apikey`, which writeGuard accepts.
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

/** The server-side key: the `default` secret key, else the legacy service_role key. */
export function serviceRoleKey(env: Env = denoEnv): string | undefined {
  return secretKeys(env)["default"] ?? env("SUPABASE_SERVICE_ROLE_KEY") ?? env("SERVICE_ROLE_KEY");
}

/** The public client key: the `default` publishable key, else the legacy anon key. */
export function publishableKey(env: Env = denoEnv): string | undefined {
  return namedKeys(env("SUPABASE_PUBLISHABLE_KEYS"))["default"] ?? env("SUPABASE_ANON_KEY");
}
