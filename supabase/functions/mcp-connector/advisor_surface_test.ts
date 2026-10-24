// Run: deno test --allow-read supabase/functions/mcp-connector/advisor_surface_test.ts
import {
  ADVISOR_INSTRUCTIONS,
  ADVISOR_SERVER_INFO,
  ADVISOR_TOOL_NAMES,
  ADVISOR_TOOLS,
  isAdvisorSurface,
} from "./advisor/mod.ts";
import { handleAdvisorJsonRpc, initAdvisorHandlers } from "./advisor/protocol.ts";
// budget_options unit tests ride along with this CI-run file.
import "./advisor/budget_test.ts";
// Variant and 911 generation matching (variants_test) also rides along so CI runs it.
import "./advisor/variants_test.ts";
import { assertEnvelopeShape } from "./advisor/evidence.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const EXPECTED = [
  "find_asset",
  "get_asset",
  "get_comps",
  "value_asset",
  "evaluate_listing",
  "budget_options",
];

Deno.test("advisor catalog is curated read-only tools with outputSchema", () => {
  assert(ADVISOR_TOOLS.length === EXPECTED.length, `expected ${EXPECTED.length} tools, got ${ADVISOR_TOOLS.length}`);
  assert(ADVISOR_TOOL_NAMES.size === EXPECTED.length, "unique names");
  const names = ADVISOR_TOOLS.map((t) => t.name).sort();
  assert(JSON.stringify(names) === JSON.stringify([...EXPECTED].sort()), `names=${names}`);
  for (const tool of ADVISOR_TOOLS) {
    assert(tool.annotations.readOnlyHint === true, `${tool.name} readOnly`);
    assert(tool.annotations.destructiveHint === false, `${tool.name} not destructive`);
    assert(tool.outputSchema && typeof tool.outputSchema === "object", `${tool.name} outputSchema`);
    assert(/^[A-Z]/.test(tool.description) || tool.description.includes("Find") || tool.description.includes("Load") || tool.description.includes("Return") || tool.description.includes("Estimate") || tool.description.includes("Evaluate") || tool.description.includes("Rank"), `${tool.name} verb-first description`);
    assert(!tool.description.includes("Always cite"), `${tool.name} descriptions stay short`);
  }
  const forbidden = [
    "execute_sql",
    "submit_observation",
    "find_listings",
    "get_history",
    "explain_field",
    "get_coverage",
    "get_vehicle",
    "decode_vin",
    "compute_valuation",
  ];
  for (const name of forbidden) {
    assert(!ADVISOR_TOOL_NAMES.has(name), `${name} must not appear on advisor`);
  }
});

Deno.test("isAdvisorSurface accepts path, query, and header", () => {
  const cases: Array<{ req: Request; want: boolean }> = [
    { req: new Request("https://nuke.ag/mcp"), want: false },
    { req: new Request("https://nuke.ag/mcp?surface=chatgpt"), want: false },
    { req: new Request("https://nuke.ag/mcp?surface=advisor"), want: true },
    { req: new Request("https://nuke.ag/mcp/advisor"), want: true },
    { req: new Request("https://qkgaybvrernstplzjaam.supabase.co/functions/v1/mcp-connector/advisor"), want: true },
    {
      req: new Request("https://nuke.ag/mcp", { headers: { "x-nuke-surface": "advisor" } }),
      want: true,
    },
    {
      req: new Request("https://nuke.ag/mcp?surface=chatgpt", { headers: { "X-Nuke-Surface": "advisor" } }),
      want: true,
    },
  ];
  for (const { req, want } of cases) {
    assert(isAdvisorSurface(req) === want, `${req.url} header=${req.headers.get("x-nuke-surface")}`);
  }
});

Deno.test("advisor JSON-RPC lists tools, refuses writes, and returns envelopes", async () => {
  const calls: string[] = [];
  initAdvisorHandlers({
    sb: () => {
      throw new Error("sb should not be called for refused tools");
    },
    callEdgeApi: async () => {
      throw new Error("callEdgeApi should not be called for refused tools");
    },
  });

  const init = await handleAdvisorJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
  });
  const initResult = init?.result as { serverInfo: { name: string }; instructions: string } | undefined;
  assert(Boolean(initResult) && initResult!.serverInfo.name === ADVISOR_SERVER_INFO.name, "serverInfo");
  assert(initResult!.instructions.includes("citation"), "instructions cite");
  assert(initResult!.instructions === ADVISOR_INSTRUCTIONS, "instructions exact");

  const list = await handleAdvisorJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (list!.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort();
  assert(JSON.stringify(tools) === JSON.stringify([...EXPECTED].sort()), "list");

  for (const name of ["execute_sql", "submit_observation", "get_vehicle", "future_private_tool"]) {
    const denied = await handleAdvisorJsonRpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name, arguments: {} },
    });
    assert(denied?.error?.code === -32602, `${name} must be refused`);
  }

  // Re-init with stub handlers via deps that return empty vehicle for get_asset path through real handler.
  // Use a minimal stub supabase for get_coverage-style path: wire createAdvisorHandlers with mock.
  initAdvisorHandlers({
    sb: () => mockSupabase({
      vehicles: {
        single: {
          id: "14123fbf-7eb6-4dd6-b0ca-bbc83db06a28",
          year: 1974,
          make: "Volkswagen",
          model: "Karmann Ghia Coupe",
          vin: "1442612348",
          color: "Green",
          mileage: 24000,
          listing_url: "https://bringatrailer.com/listing/1974-volkswagen-karmann-ghia-coupe-5/",
          bat_auction_url: "https://bringatrailer.com/listing/1974-volkswagen-karmann-ghia-coupe-5",
          canonical_platform: "bat",
          observation_count: 4,
          image_count: 120,
          status: "active",
        },
      },
      vehicle_observations: [],
      vehicle_events: { count: 2 },
      vehicle_images: { count: 120 },
      nuke_estimates: [],
      observation_sources: [],
      vehicle_field_evidence: [],
      rpcs: {
        vehicle_price_facts: [{
          price_kind: "sold",
          price_amount: 21000,
          price_as_of: "2024-07-07T00:00:00+00:00",
          price_live: false,
          outcome: "sold",
          sold_basis: "status",
          sold_amount: 21000,
          sold_on: "2024-07-07",
          sold_amount_from: "sale_price",
          ask_amount: null,
          bid_amount: 21000,
          bid_on: "2024-07-07",
          bid_from: "high_bid",
          estimate_amount: 16500,
          estimate_confidence: 70,
          estimate_as_of: "2026-02-08T15:29:23.928054+00:00",
          source_url: "https://bringatrailer.com/listing/1974-volkswagen-karmann-ghia-coupe-5/",
        }],
        project_attribute: null,
      },
    }) as never,
    callEdgeApi: async () => ({ data: [], summary: {}, query: {} }),
  });

  const asset = await handleAdvisorJsonRpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "get_asset", arguments: { asset_id: "14123fbf-7eb6-4dd6-b0ca-bbc83db06a28" } },
  });
  assert(!asset?.error, `get_asset error ${JSON.stringify(asset?.error)}`);
  const result = asset!.result as {
    content: Array<{ text: string }>;
    structuredContent: unknown;
  };
  assert(Array.isArray(result.content) && Boolean(result.content[0]?.text), "text content");
  assertEnvelopeShape(result.structuredContent);
  const envelope = result.structuredContent as {
    tool: string;
    claims: Array<{ field: string; value: unknown }>;
  };
  assert(envelope.tool === "get_asset", "tool name");
  const make = envelope.claims.find((c) => c.field === "make");
  assert(make?.value === "Volkswagen", `make=${make?.value}`);
  const sale = envelope.claims.find((c) => c.field === "sale_price");
  assert(sale?.value === 21000, `sale_price=${sale?.value}`);
  void calls;
});

/** Minimal thenable query builder for advisor handler tests. */
function mockSupabase(state: Record<string, unknown>) {
  function from(table: string) {
    const tableState = state[table];
    const filters: Array<() => boolean> = [];
    let mode: "select" | "head" = "select";
    let wantSingle = false;
    let wantMaybe = false;

    const api: Record<string, unknown> = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) mode = "head";
        return api;
      },
      eq() {
        return api;
      },
      in() {
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      range() {
        return api;
      },
      textSearch() {
        return api;
      },
      ilike() {
        return api;
      },
      gte() {
        return api;
      },
      lte() {
        return api;
      },
      single() {
        wantSingle = true;
        return Promise.resolve(resolve());
      },
      maybeSingle() {
        wantMaybe = true;
        return Promise.resolve(resolve());
      },
      then(resolveCb: (v: unknown) => unknown, rejectCb?: (e: unknown) => unknown) {
        return Promise.resolve(resolve()).then(resolveCb, rejectCb);
      },
    };

    function resolve() {
      if (mode === "head") {
        const count = typeof tableState === "object" && tableState && "count" in (tableState as object)
          ? (tableState as { count: number }).count
          : Array.isArray(tableState)
          ? tableState.length
          : 0;
        return { data: null, error: null, count };
      }
      if (Array.isArray(tableState)) {
        return { data: tableState, error: null, count: tableState.length };
      }
      if (tableState && typeof tableState === "object" && "single" in (tableState as object)) {
        const row = (tableState as { single: unknown }).single;
        if (wantSingle || wantMaybe) return { data: row, error: null };
        return { data: [row], error: null };
      }
      return { data: wantSingle || wantMaybe ? null : [], error: null };
    }

    void filters;
    return api;
  }

  return {
    from,
    rpc(name: string, _args?: unknown) {
      const rpcs = (state.rpcs || {}) as Record<string, unknown>;
      return Promise.resolve({ data: rpcs[name] ?? null, error: null });
    },
  };
}
