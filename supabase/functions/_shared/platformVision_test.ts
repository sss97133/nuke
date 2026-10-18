import { platformVisionMultiJSON } from "./visionFallback.ts";
import { VisionProviderUnavailable } from "./providerDiagnostic.ts";

const equal = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("platform contract differs");
};
const opts = { parts: [{ text: "offline fixture" }, { imageUrl: "data:image/jpeg;base64,YQ==" },
  { imageUrl: "data:image/jpeg;base64,Yg==" }], maxTokens: 1600 };
function fixture() {
  const events: string[] = [];
  const deps = {
    env: (name: string) => name === "NUKE_PHOTO_ANTHROPIC_API_KEY" ? "fixture"
      : name === "NUKE_PHOTO_ANTHROPIC_WORKSPACE_ID" ? "workspace-fixture" : undefined,
    reserve: async () => { events.push("reserve"); return { status: "reserved" as const, hold_id: "hold" }; },
    settle: async (_db: unknown, _user: string, _hold: string, cents: number) => { events.push(`settle:${cents}`); },
    call: async (config: any) => {
      equal([config.provider, config.source, config.model], ["anthropic", "system", "claude-haiku-5-5"]);
      equal(config.workspaceId, "workspace-fixture");
      events.push("inference");
      return { content: '{"subjects":[]}', usage: { input_tokens: 5000, output_tokens: 300 }, duration_ms: 1 } as any;
    },
  };
  return { events, deps };
}
async function failure(action: () => Promise<unknown>) {
  try { await action(); } catch (error) {
    if (error instanceof VisionProviderUnavailable) return error;
    throw error;
  }
  throw new Error("expected refusal");
}

Deno.test("platform reserves before inference and charges only after protected retention", async () => {
  const { events, deps } = fixture();
  const result = await platformVisionMultiJSON({}, "owner", opts, deps);
  equal(events, ["reserve", "inference"]);
  equal((await result.settleBilling!(false)).status, "pending");
  equal(events, ["reserve", "inference"]);
  equal((await result.settleBilling!(true)).status, "settled");
  equal(events, ["reserve", "inference", "settle:1"]);
});

Deno.test("missing platform configuration never reads a customer key or starts inference", async () => {
  const { events, deps } = fixture();
  const error = await failure(() => platformVisionMultiJSON({}, "owner", opts, { ...deps, env: () => undefined }));
  equal(error.diagnostics[0].code, "platform_not_configured");
  equal(error.coverage.no_reading_started, true);
  equal(events, []);
});

Deno.test("unfunded and duplicate requests never start paid inference", async () => {
  for (const status of ["insufficient_funds", "duplicate"] as const) {
    const { events, deps } = fixture();
    const error = await failure(() => platformVisionMultiJSON({}, "owner", opts, { ...deps,
      reserve: async () => ({ status }) }));
    equal(error.diagnostics[0].code, status === "duplicate" ? "analysis_pending" : "analysis_balance_required");
    equal(events, []);
  }
});

Deno.test("transport ambiguity retains reservation and never retries", async () => {
  const { events, deps } = fixture();
  const error = await failure(() => platformVisionMultiJSON({}, "owner", opts, { ...deps,
    call: async () => { events.push("inference"); throw new Error("private transport detail"); } }));
  equal(events, ["reserve", "inference"]);
  equal(error.coverage.no_reading_started, false);
  equal(JSON.stringify(error).includes("private transport detail"), false);
});

Deno.test("unreadable response is recorded without charging the customer", async () => {
  const { events, deps } = fixture();
  const error = await failure(() => platformVisionMultiJSON({}, "owner", opts, { ...deps,
    call: async () => ({ content: "[]" } as any) }));
  equal(events, ["reserve", "settle:0"]);
  equal(error.diagnostics[0].code, "platform_result_unreadable");
  equal(error.coverage.no_reading_started, false);
});

Deno.test("missing usage or failed settlement preserves the interpretation with pending billing", async () => {
  for (const missingUsage of [true, false]) {
    const { deps } = fixture();
    const result = await platformVisionMultiJSON({}, "owner", opts, { ...deps,
      call: missingUsage ? async () => ({ content: '{"subjects":[]}' } as any) : deps.call,
      settle: async () => { throw new Error("private settlement failure"); } });
    equal(result.data, { subjects: [] });
    equal((await result.settleBilling!(true)).status, "pending");
  }
});

Deno.test("three-frame reading can exceed the old output ceiling within the same two-cent reservation", async () => {
  const { deps, events } = fixture();
  let reserved = 0, outputLimit = 0;
  const result = await platformVisionMultiJSON({}, "owner", {
    parts: [...opts.parts, { imageUrl: "data:image/jpeg;base64,Yw==" }], maxTokens: 4096,
  }, { ...deps,
    reserve: async (_db, _owner, cents) => { reserved = cents; return { status: "reserved", hold_id: "hold" }; },
    call: async (_config, _messages, options) => {
      outputLimit = options!.maxTokens!;
      return { content: '{"subjects":[]}', finish_reason: "end_turn",
        usage: { input_tokens: 8035, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
    },
  });
  equal([reserved, outputLimit], [2, 4096]);
  equal(result.data, { subjects: [] });
  equal((await result.settleBilling!(true)).status, "settled");
  equal(events, ["settle:1"]);
});

Deno.test("token-limited JSON is never retained as a complete reading or charged and is not retried", async () => {
  const { deps } = fixture();
  let calls = 0, release: unknown;
  const error = await failure(() => platformVisionMultiJSON({}, "owner", opts, { ...deps,
    call: async () => { calls++; return { content: '{"subjects":[]}', finish_reason: "max_tokens",
      usage: { input_tokens: 8035, output_tokens: 1600 } }; },
    settle: async (_db, _owner, _hold, cents, metadata) => { release = { cents, metadata }; },
  }));
  equal(calls, 1);
  equal(error.diagnostics[0].code, "platform_result_unreadable");
  equal((release as any).cents, 0);
  equal((release as any).metadata.output_limit_reached, true);
  equal((release as any).metadata.provider_read, "unreadable");
});

Deno.test("output ceiling stays bounded before reservation or inference", async () => {
  const { deps, events } = fixture();
  await failure(() => platformVisionMultiJSON({}, "owner", { ...opts, maxTokens: 4097 }, deps));
  equal(events, []);
});
