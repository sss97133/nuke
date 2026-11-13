// Retired 2026-11-11: sent email to a business owner from unauthenticated input, outside the outbound gate.
// No callers in the repo. Sends nothing. Restore only through supabase/functions/_shared/outbound.ts.
Deno.serve(() =>
  new Response(JSON.stringify({ error: "retired", sent: false }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
