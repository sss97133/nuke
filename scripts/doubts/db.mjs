// Service-role PostgREST client for the doubt scripts. Never prints the key.
export const PROJECT_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
export function client(env = process.env) {
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY required (run under dotenvx)');
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? PROJECT_URL;
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const req = async (path, init = {}) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120000) });
      if (res.ok) { const t = await res.text(); return t ? JSON.parse(t) : null; }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
      throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
  };
  const rpc = (fn, body) => req(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
  // An edge function call (a sanctioned writer): { ok, status, json }; a 4xx is returned, not thrown, so a refusal is counted.
  const fn = async (name, body) => {
    const res = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const t = await res.text(); let json = null; try { json = t ? JSON.parse(t) : null; } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  };
  return { req, rpc, fn };
}
export const arg = (argv, n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
