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
