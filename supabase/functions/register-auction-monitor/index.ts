// register-auction-monitor: RETIRED STUB (2026-10-07, lead skylar-64; found by the describe-batch10 lane, PR #838).
//
// This function's source left the repo on 2026-03-31, but its deployment (version 79, 2026-02-12) stayed live with no
// write guard and admits anonymous writes into monitored_auctions (the lane read the deployed source through the
// management API and did not probe it; a bare GET fails at JSON parsing and writes nothing, a POST writes). The live BaT
// pull (bat_live_pull_run, cron job 510) is the only sanctioned writer of monitored_auctions today. This stub replaces the
// live deployment through CI: every caller passes requireWriteAuth (service_role, a valid user JWT, or an API key; the
// public anon key is refused), and even an authenticated caller gets 410 Gone, because the retired body is not in the
// repo and cannot be reviewed. Restoring the function means restoring its source from git history with the guard in
// place, never redeploying the unreviewed bundle. Deleting the deployment is the owner's call (the orphan-deletion batch).
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
      function: 'register-auction-monitor',
      message: 'This function was retired on 2026-10-07: its source is no longer in the repository and the live deployment admitted anonymous writes into monitored_auctions. Restore it from git history behind the write guard if it is still needed.',
    }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
