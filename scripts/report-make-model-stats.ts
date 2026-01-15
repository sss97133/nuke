#!/usr/bin/env node
/**
 * Report make/model statistics from the Supabase/Postgres database.
 *
 * Outputs:
 *  1) Vehicle counts per make+model (from `public.vehicles`)
 *  2) All models per make (from `public.vehicles`)
 *
 * Notes:
 * - This script uses an admin-style PostgREST RPC for ad-hoc SELECT queries (commonly `execute_sql` or `exec_sql`).
 * - It normalizes blank make/model to "[unknown]" so you can spot data-quality issues quickly.
 *
 * Usage:
 *   tsx scripts/report-make-model-stats.ts
 *   tsx scripts/report-make-model-stats.ts --out data/json/make_model_stats.json
 *   tsx scripts/report-make-model-stats.ts --include-merged
 *
 * Env:
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY (preferred) OR SUPABASE_ANON_KEY (limited by RLS)
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

type CliOptions = {
  outPath: string;
  excludeMerged: boolean;
  verbose: boolean;
};

function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), "nuke_frontend/.env.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    outPath: path.join(process.cwd(), "data/json/make_model_stats.json"),
    excludeMerged: true,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.outPath = path.resolve(process.cwd(), argv[++i] || "");
    else if (a === "--include-merged") opts.excludeMerged = false;
    else if (a === "--verbose") opts.verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Make/Model Stats Reporter

Usage:
  tsx scripts/report-make-model-stats.ts [--out <path>] [--include-merged] [--verbose]

Flags:
  --out <path>         Write output JSON to <path> (default: data/json/make_model_stats.json)
  --include-merged     Include vehicles with status='merged' in counts (default: excluded)
  --verbose            More logging
`);
      process.exit(0);
    }
  }

  if (!opts.outPath.endsWith(".json")) {
    throw new Error(`--out must be a .json file (got: ${opts.outPath})`);
  }
  return opts;
}

function requireAnyEnv(names: string[]): string {
  for (const n of names) {
    const v = (process.env[n] || "").trim();
    if (v) return v;
  }
  throw new Error(`Missing required env var. Provide one of: ${names.join(", ")}`);
}

async function postExecSql(
  supabaseUrl: string,
  key: string,
  rpcName: "exec_sql" | "execute_sql",
  payload: Record<string, unknown>
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; body: string }> {
  const resp = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, body };
  }

  // Some `exec_sql` variants return 204 for DDL. For SELECT we expect JSON.
  const text = await resp.text().catch(() => "");
  if (!text.trim()) return { ok: true, data: [] };
  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: true, data: text };
  }
}

function unwrapExecSqlResult(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw as any[];
  if (raw && typeof raw === "object") {
    const r: any = raw;
    // Some implementations return { error: "..." } with HTTP 200
    if (typeof r.error === "string" && r.error.trim()) return [];
    if (Array.isArray(r.data)) return r.data;
    if (Array.isArray(r.result)) return r.result;
    if (Array.isArray(r.rows)) return r.rows;
  }
  return [];
}

function extractExecSqlError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r: any = raw;
  if (typeof r.error === "string" && r.error.trim()) return r.error.trim();
  if (typeof r.message === "string" && r.message.trim()) return r.message.trim();
  return null;
}

async function execSql(supabaseUrl: string, key: string, sql: string, verbose: boolean): Promise<any[]> {
  const trimmed = sql.trim();
  const normalizedWithSemicolon = trimmed.endsWith(";") ? trimmed : `${trimmed};`;
  const normalizedWithoutSemicolon = normalizedWithSemicolon.replace(/;\s*$/, "");
  const attempts: Array<{ label: string; payload: Record<string, unknown> }> = [
    { label: "{sql}", payload: { sql: normalizedWithSemicolon } },
    { label: "{sql_query}", payload: { sql_query: normalizedWithSemicolon } },
    { label: "{query}", payload: { query: normalizedWithSemicolon } },
  ];

  const rpcNames: Array<"exec_sql" | "execute_sql"> = ["exec_sql", "execute_sql"];

  const errors: string[] = [];
  for (const rpcName of rpcNames) {
    for (const a of attempts) {
      const payload =
        rpcName === "execute_sql" && "query" in a.payload
          ? { ...a.payload, query: normalizedWithoutSemicolon }
          : a.payload;

      const res = await postExecSql(supabaseUrl, key, rpcName, payload);
      if (res.ok) {
        const maybeErr = extractExecSqlError(res.data);
        if (maybeErr) {
          const msg = `${rpcName} returned error using payload ${a.label}: ${maybeErr}`;
          errors.push(msg);
          if (verbose) console.log(msg);
          continue;
        }
        const rows = unwrapExecSqlResult(res.data);
        if (verbose) console.log(`${rpcName} ok using payload ${a.label} (rows=${rows.length})`);
        return rows;
      }
      const msg = `${rpcName} failed using payload ${a.label}: HTTP ${res.status} ${res.body?.slice(0, 300) || ""}`;
      errors.push(msg);
      if (verbose) console.log(msg);
    }
  }

  throw new Error(
    `Could not execute SQL via PostgREST RPC. Tried function names: exec_sql, execute_sql.\nTried payload keys: sql, sql_query, query.\n\n` +
      errors.join("\n")
  );
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

async function main(): Promise<void> {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  const supabaseUrl = requireAnyEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const key = (() => {
    const service = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
    if (service) return service;
    const anon = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
    if (anon) return anon;
    return "";
  })();

  if (!key) {
    throw new Error(
      "Missing Supabase key. Set SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)."
    );
  }

  const vehicleWhere = opts.excludeMerged ? `v.status IS DISTINCT FROM 'merged'` : `TRUE`;

  const diagnosticsSql = `
SELECT
  (SELECT COUNT(*)::int FROM public.vehicles v WHERE ${vehicleWhere}) AS total_vehicles,
  (SELECT COUNT(*)::int FROM public.vehicles v WHERE ${vehicleWhere} AND btrim(coalesce(v.make, '')) = '') AS vehicles_missing_make,
  (SELECT COUNT(*)::int FROM public.vehicles v WHERE ${vehicleWhere} AND btrim(coalesce(v.model, '')) = '') AS vehicles_missing_model,
  (SELECT COUNT(DISTINCT COALESCE(NULLIF(btrim(v.make), ''), '[unknown]'))::int FROM public.vehicles v WHERE ${vehicleWhere}) AS distinct_makes,
  (SELECT COUNT(*)::int
   FROM (
     SELECT 1
     FROM public.vehicles v
     WHERE ${vehicleWhere}
     GROUP BY
       COALESCE(NULLIF(btrim(v.make), ''), '[unknown]'),
       COALESCE(NULLIF(btrim(v.model), ''), '[unknown]')
   ) t
  ) AS distinct_make_model_pairs
`;

  const productionCountsSql = `
SELECT
  COALESCE(NULLIF(btrim(v.make), ''), '[unknown]') AS make,
  COALESCE(NULLIF(btrim(v.model), ''), '[unknown]') AS model,
  COUNT(*)::int AS vehicle_count
FROM public.vehicles v
WHERE ${vehicleWhere}
GROUP BY 1, 2
ORDER BY 1, 2
`;

  const modelsByMakeSql = `
SELECT
  COALESCE(NULLIF(btrim(v.make), ''), '[unknown]') AS make,
  COUNT(DISTINCT COALESCE(NULLIF(btrim(v.model), ''), '[unknown]'))::int AS model_count,
  ARRAY_AGG(
    DISTINCT COALESCE(NULLIF(btrim(v.model), ''), '[unknown]')
    ORDER BY COALESCE(NULLIF(btrim(v.model), ''), '[unknown]')
  ) AS models
FROM public.vehicles v
WHERE ${vehicleWhere}
GROUP BY 1
ORDER BY 1
`;

  if (opts.verbose) console.log("Running diagnostics query...");
  const diagnosticsRows = await execSql(supabaseUrl, key, diagnosticsSql, opts.verbose);
  const diagnostics = (diagnosticsRows && diagnosticsRows[0]) || {};

  if (opts.verbose) console.log("Running production counts query...");
  const productionCounts = await execSql(supabaseUrl, key, productionCountsSql, opts.verbose);

  if (opts.verbose) console.log("Running models-by-make query...");
  const modelsByMake = await execSql(supabaseUrl, key, modelsByMakeSql, opts.verbose);

  ensureDir(path.dirname(opts.outPath));
  const out = {
    generated_at: new Date().toISOString(),
    source: {
      supabase_url: supabaseUrl,
      vehicle_table: "public.vehicles",
      exclude_merged: opts.excludeMerged,
    },
    diagnostics,
    production_counts: productionCounts,
    models_by_make: modelsByMake,
  };

  fs.writeFileSync(opts.outPath, JSON.stringify(out, null, 2));

  console.log(`Wrote ${opts.outPath}`);
  if (diagnostics?.total_vehicles !== undefined) console.log(`Vehicles (total): ${diagnostics.total_vehicles}`);
  if (diagnostics?.distinct_makes !== undefined) console.log(`Distinct makes: ${diagnostics.distinct_makes}`);
  if (diagnostics?.distinct_make_model_pairs !== undefined)
    console.log(`Distinct make+model pairs: ${diagnostics.distinct_make_model_pairs}`);
  console.log(`Production rows (make+model): ${productionCounts.length}`);
  console.log(`Makes (models_by_make rows): ${modelsByMake.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

