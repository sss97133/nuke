// platform-financials: RETIRED STUB (2026-10-07, lead skylar-64).
//
// This function's source left the repo in the March/April 2026 dead-function cleanups, but its deployment stayed live
// with no write guard. On 2026-10-07 05:41Z an unauthenticated GET to it ran work or returned private data (see
// ~/nuke-logs/data-hygiene-20261005/edge-functions-liveness-20261007.txt and PLAN.md 06:40Z). This stub replaces the
// live deployment through CI: every caller passes requireWriteAuth (service_role, a valid user JWT, or an API key;
// the public anon key is refused), and even an authenticated caller gets 410 Gone, because the retired body is not
// in the repo and cannot be reviewed. Restoring the function means restoring its source from git history with the
// guard in place, never redeploying the unreviewed bundle. Deleting the deployment outright is the owner's call.
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
      function: 'platform-financials',
      message: 'This function was retired on 2026-10-07: its source is no longer in the repository and the live deployment answered unauthenticated requests. Restore it from git history behind the write guard if it is still needed.',
    }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
