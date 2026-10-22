import { callReceiptIntake } from "./receiptTools.ts";

Deno.test("receipt MCP forwards only caller credentials and pins intake mode", async () => {
  const originalFetch = globalThis.fetch;
  let seen = false;
  globalThis.fetch = async (input, init) => {
    seen = true;
    if (input !== "https://example.supabase.co/functions/v1/ingest-artifact") throw new Error("Wrong intake");
    const headers = new Headers(init?.headers);
    if (headers.get("authorization") !== "Bearer nk_live_member" || headers.get("x-api-key") !== null || headers.get("cookie") !== null || headers.get("apikey") !== null) throw new Error("Credential boundary failed");
    const body = JSON.parse(String(init?.body));
    if (body.mode !== "receipt_intake_v1" || body.action !== "read") throw new Error("Wrong contract");
    return new Response('{"error":"membership revoked"}', { status: 403 });
  };
  try {
    const result = await callReceiptIntake(new Request("https://nuke.ag/mcp", { headers: {
      authorization: "Bearer nk_live_member", cookie: "do-not-forward", apikey: "fixture",
    } }), { action: "read", mode: "legacy" }, "https://example.supabase.co");
    if (!seen || result.status !== 403) throw new Error("Refusal not preserved");
  } finally { globalThis.fetch = originalFetch; }
});
