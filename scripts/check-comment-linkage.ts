// Bounded live assay for the auction-comment identity edge (data-machine C6).
// node scripts/check-comment-linkage.ts [--since <ISO timestamp>]
// Uses the sanctioned read-only q.sh path. No full-table counts, names, text, or writes.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--since" || !Number.isFinite(Date.parse(args[1])))) {
  console.error("usage: node scripts/check-comment-linkage.ts [--since <ISO timestamp>]");
  process.exit(2);
}
const since = args.length ? new Date(args[1]).toISOString() : null;
const query = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH recent AS MATERIALIZED (
  SELECT platform, author_username, bat_author_id, external_identity_id, vehicle_id, auction_event_id, created_at
  FROM public.auction_comments
  ${since ? `WHERE created_at > '${since}'::timestamptz` : ""}
  ORDER BY created_at DESC LIMIT 10000
), sampled AS (
  SELECT r.*, e.id AS exact_match_id,
    (r.platform = 'bat' AND r.author_username IS NOT NULL
      AND btrim(r.author_username) NOT IN ('', 'Unknown')
      AND NOT (lower(r.author_username) = 'anonymous' AND coalesce(r.bat_author_id,0) <= 0)) AS identifiable
  FROM recent r LEFT JOIN public.external_identities e
    ON e.platform = r.platform AND e.handle = r.author_username
), metrics AS (
  SELECT platform, count(*) AS sampled,
    min(created_at) AS oldest, max(created_at) AS newest,
    count(*) FILTER (WHERE identifiable) AS identifiable,
    count(*) FILTER (WHERE identifiable AND external_identity_id IS NOT NULL) AS linked,
    count(*) FILTER (WHERE identifiable AND external_identity_id IS NULL) AS missing,
    count(*) FILTER (WHERE identifiable AND external_identity_id IS NULL AND exact_match_id IS NOT NULL) AS missing_with_existing_identity,
    count(*) FILTER (WHERE identifiable AND external_identity_id IS NOT NULL AND external_identity_id IS DISTINCT FROM exact_match_id) AS mismatched_identity,
    count(*) FILTER (WHERE vehicle_id IS NULL) AS missing_vehicle,
    count(*) FILTER (WHERE auction_event_id IS NULL) AS missing_auction_event
  FROM sampled GROUP BY platform
)
SELECT jsonb_build_object('assay','auction_comment_identity_v1','measured_at',now(),
  'sample_limit',10000,'since',${since ? `'${since}'` : "null"},
  'platforms',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM metrics m),'[]'::jsonb)) AS assay;
COMMIT;`;

try {
  const qPath = fileURLToPath(new URL("./data/q.sh", import.meta.url));
  const raw = execFileSync("/bin/bash", [qPath, query], { encoding: "utf8", timeout: 25000, stdio: ["ignore", "pipe", "pipe"] });
  const result = JSON.parse(raw);
  if (!Array.isArray(result) || !result[0]?.assay) throw new Error("Query returned no assay; do not report a successful measurement");
  console.log(JSON.stringify(result[0].assay, null, 2));
} catch {
  // Don't echo subprocess stderr: credential-bearing tools may print their arguments on failure.
  console.error("Comment identity assay failed; no coverage claim can be made.");
  process.exitCode = 1;
}
