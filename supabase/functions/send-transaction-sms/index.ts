// Retired 2026-11-11: sent Twilio SMS to buyer and seller phones with no auth check, outside the outbound gate.
// Its table (vehicle_transactions) no longer exists, so every call already failed. Sends nothing.
// Restore only through supabase/functions/_shared/outbound.ts.
Deno.serve(() =>
  new Response(JSON.stringify({ error: "retired", sent: false }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
