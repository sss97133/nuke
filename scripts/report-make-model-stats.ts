#!/usr/bin/env node
/**
 * Report make/model statistics from the Supabase/Postgres database.
 *
 * Outputs:
 *  1) Vehicle counts per make+model (includes zero-count models when the ECR catalog exists)
 *  2) All models per make (from the ECR catalog)
 *
 * This repo commonly exposes a PostgREST RPC named `exec_sql` for running ad-hoc SQL. This script
 * uses it (service role recommended). If `exec_sql` is missing/unavailable, the script will fail
 * with a helpful error.
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
  payload: Record<string, unknown>
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; body: string }> {
  const resp = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/exec_sql`, {
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
    if (Array.isArray(r.data)) return r.data;
    if (Array.isArray(r.result)) return r.result;
    if (Array.isArray(r.rows)) return r.rows;
  }
  return [];
}

async function execSql(supabaseUrl: string, key: string, sql: string, verbose: boolean): Promise<any[]> {
  const normalized = sql.trim().endsWith(";") ? sql.trim() : `${sql.trim()};`;
  const attempts: Array<{ label: string; payload: Record<string, unknown> }> = [
    { label: "{sql}", payload: { sql: normalized } },
    { label: "{sql_query}", payload: { sql_query: normalized } },
    { label: "{query}", payload: { query: normalized } },
  ];

  const errors: string[] = [];
  for (const a of attempts) {
    const res = await postExecSql(supabaseUrl, key, a.payload);
    if (res.ok) {
      const rows = unwrapExecSqlResult(res.data);
      if (verbose) console.log(`exec_sql ok using payload ${a.label} (rows=${rows.length})`);
      return rows;
    }
    const msg = `exec_sql failed using payload ${a.label}: HTTP ${res.status} ${res.body?.slice(0, 300) || ""}`;
    errors.push(msg);
    if (verbose) console.log(msg);
  }

  throw new Error(
    `Could not execute SQL via rpc/exec_sql. Tried payload keys: sql, sql_query, query.\n\n` + errors.join("\n")
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

  const vehicleWhere = opts.excludeMerged ? `WHERE v.status IS DISTINCT FROM 'merged'` : ``;

  // Query 1: vehicle counts per make+model, including zero-count models via ECR catalog.
  const productionCountsSql = `
WITH vehicle_counts AS (
  SELECT
    lower(v.make) AS make_lc,
    lower(v.model) AS model_lc,
    count(*)::int AS vehicle_count
  FROM public.vehicles v
  ${vehicleWhere}
  GROUP BY 1, 2
)
SELECT
  em.ecr_make_slug,
  em.make_name AS make,
  ecm.ecr_model_slug,
  ecm.model_name AS model,
  coalesce(vc.vehicle_count, 0)::int AS vehicle_count
FROM public.ecr_makes em
JOIN public.ecr_models ecm
  ON ecm.ecr_make_slug = em.ecr_make_slug
LEFT JOIN vehicle_counts vc
  ON vc.make_lc = lower(em.make_name)
 AND vc.model_lc = lower(ecm.model_name)
ORDER BY em.make_name, ecm.model_name
`;

  // Query 2: all models per make (ECR catalog).
  const modelsByMakeSql = `
SELECT
  em.ecr_make_slug,
  em.make_name AS make,
  count(ecm.ecr_model_slug)::int AS model_count,
  array_agg(ecm.model_name ORDER BY ecm.model_name) AS models
FROM public.ecr_makes em
JOIN public.ecr_models ecm
  ON ecm.ecr_make_slug = em.ecr_make_slug
GROUP BY em.ecr_make_slug, em.make_name
ORDER BY em.make_name
`;

  if (opts.verbose) console.log("Running production counts query...");
  const productionCounts = await execSql(supabaseUrl, key, productionCountsSql, opts.verbose);

  if (opts.verbose) console.log("Running models-by-make query...");
  const modelsByMake = await execSql(supabaseUrl, key, modelsByMakeSql, opts.verbose);

  ensureDir(path.dirname(opts.outPath));
  const out = {
    generated_at: new Date().toISOString(),
    source: {
      supabase_url: supabaseUrl,
      catalog: "ecr_makes/ecr_models",
      vehicle_table: "public.vehicles",
      exclude_merged: opts.excludeMerged,
    },
    production_counts: productionCounts,
    models_by_make: modelsByMake,
  };

  fs.writeFileSync(opts.outPath, JSON.stringify(out, null, 2));

  console.log(`Wrote ${opts.outPath}`);
  console.log(`Production rows: ${productionCounts.length}`);
  console.log(`Makes (models_by_make rows): ${modelsByMake.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

