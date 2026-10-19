// deno test supabase/functions/_shared/writeResult.test.ts
import { mustWrite, softWrite } from "./writeResult.ts";

function equal(actual: unknown, expected: unknown, label = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("mustWrite passes a successful result through", () => {
  const ok = { data: [1], error: null };
  equal(mustWrite("t insert", ok), ok);
});

Deno.test("mustWrite throws with label, message and code", () => {
  let msg = "";
  try {
    mustWrite("auction_events upsert", { error: { message: "column x does not exist", code: "42703" } });
  } catch (e) {
    msg = (e as Error).message;
  }
  equal(msg, "auction_events upsert failed: column x does not exist (42703)");
});

Deno.test("softWrite records the error and returns it, null on success", () => {
  const errors: string[] = [];
  equal(softWrite("a", { error: null }, errors), null);
  equal(softWrite("b", { error: { message: "boom" } }, errors), "b failed: boom");
  equal(errors, ["b failed: boom"]);
});
