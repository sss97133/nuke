// backfill-quality-scores: RETIRED STUB (2026-10-07, lead skylar-64; found by the describe-batch6 lane, PR #807).
//
// This function's source left the repo on 2026-03-31, but its deployment (version 26, verify_jwt false, no write guard)
// stayed live and WRITES on any request without a body: it upserts 500 rows into vehicle_quality_scores per call. Two
// unauthenticated GET liveness sweeps triggered it (2026-09-30 20:25Z, a node sweep of 79 functions; 2026-10-07 05:40Z,
// the curl sweep of every deployed function; the function logged batch=500 at 05:40:11Z). This stub replaces the live
// deployment through CI: every caller passes requireWriteAuth (service_role, a valid user JWT, or an API key; the public
// anon key is refused), and even an authenticated caller gets 410 Gone, because the retired body is not in the repo and
// cannot be reviewed. Restoring the function means restoring its source from git history with the guard in place and a
// POST-only body contract, never redeploying the unreviewed bundle. Deleting the deployment is the owner's call (the
// orphan-deletion batch). Liveness probes of deployed functions must use OPTIONS, never a bare GET (memory
// project_orphaned_edge_deployments, 2026-10-07 13:20Z).
import { requireWriteAuth } from '../_shared/writeGuard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  return new Response(
    JSON.stringify({
      error: 'retired',
      function: 'backfill-quality-scores',
      message: 'This function was retired on 2026-10-07: its source is no longer in the repository and the live deployment wrote 500 vehicle_quality_scores rows on any bodiless request. Restore it from git history behind the write guard if it is still needed.',
    }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
