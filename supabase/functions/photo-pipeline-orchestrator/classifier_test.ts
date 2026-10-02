import { classifyImage } from "./classifier.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const image = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
const response = (text: string) => Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
const valid = { image_type: "engine_bay", confidence: 0, is_automotive: true, description: "A visible component" };

Deno.test("missing classifier key does not fetch pixels or invoke another model", async () => {
  let calls = 0;
  const result = await classifyImage("https://example.invalid/private.jpg?token=secret", undefined,
    (() => { calls++; throw new Error("must not fetch"); }) as typeof fetch);
  assert(calls === 0 && result.classifier_ok === false);
  assert(result.classifier_receipt?.attempts === 0 && result.classifier_receipt.model === null);
  assert(result.classifier_receipt.error_class === "classifier_key_missing");
});

for (const kind of ["http", "timeout", "transport"] as const) {
  Deno.test(`image download ${kind} is a sanitized failure before classifier request`, async () => {
    let calls = 0;
    const result = await classifyImage("https://example.invalid/private.jpg?token=secret", "synthetic-key",
      (async (_url, init) => {
        calls++; assert((init as RequestInit | undefined)?.signal instanceof AbortSignal);
        if (kind === "http") return new Response("private body", { status: 503 });
        if (kind === "timeout") throw new DOMException("private upstream URL", "TimeoutError");
        throw new Error("private credential detail");
      }) as typeof fetch);
    assert(calls === 1 && result.classifier_ok === false);
    assert(result.classifier_receipt?.attempts === 0 && result.classifier_receipt.model === null);
    assert(!JSON.stringify(result).includes("private") && !JSON.stringify(result).includes("secret"));
  });
}

for (const [name, modelResponse, expected] of [
  ["HTTP rejection", () => new Response("private body", { status: 401 }), "classifier_http_error"],
  ["empty response", () => Response.json({ candidates: [] }), "classifier_response_empty"],
  ["malformed JSON", () => response("not json"), "classifier_response_invalid"],
  ["array response", () => response("[]"), "classifier_response_invalid"],
  ["missing fields", () => response("{}"), "classifier_response_invalid"],
  ["out-of-range confidence", () => response(JSON.stringify({ ...valid, confidence: 2 })), "classifier_response_invalid"],
] as const) {
  Deno.test(`classifier ${name} retains one bounded attempt and no upstream body`, async () => {
    let calls = 0;
    const result = await classifyImage("https://example.invalid/photo.jpg", "synthetic-key",
      (async (_url, init) => { assert((init as RequestInit | undefined)?.signal instanceof AbortSignal); return ++calls === 1 ? image() : modelResponse(); }) as typeof fetch);
    assert(calls === 2 && result.classifier_ok === false);
    assert(result.classifier_receipt?.attempts === 1 && result.classifier_receipt.error_class === expected);
    assert(!JSON.stringify(result).includes("private body"));
  });
}

Deno.test("429 retries exhaust five classifier calls; no second provider is invoked", async () => {
  let calls = 0, pauses = 0;
  const result = await classifyImage("https://example.invalid/photo.jpg", "synthetic-key",
    (async () => ++calls === 1 ? image() : new Response(null, { status: 429 })) as typeof fetch,
    async ms => { assert(ms <= 10_400); pauses++; });
  assert(calls === 6 && pauses === 5 && result.classifier_ok === false);
  assert(result.classifier_receipt?.attempts === 5 && result.classifier_receipt.http_status === 429);
});

Deno.test("successful response preserves actual zero confidence and classifier identity", async () => {
  let calls = 0;
  const result = await classifyImage("https://example.invalid/photo.jpg", "synthetic-key",
    (async () => ++calls === 1 ? image() : response(JSON.stringify(valid))) as typeof fetch);
  assert(result.classifier_ok && result.confidence === 0 && result.image_type === "engine_bay");
  assert(result.classifier_receipt?.model === "gemini-2.5-flash" && result.classifier_receipt.attempts === 1);
});

Deno.test("classifier timeout reports a bounded failure without exporting exception text", async () => {
  let calls = 0;
  const result = await classifyImage("https://example.invalid/photo.jpg", "synthetic-key",
    (async () => { if (++calls === 1) return image(); throw new DOMException("secret-bearing upstream URL", "TimeoutError"); }) as typeof fetch);
  assert(calls === 2 && result.classifier_ok === false && result.classifier_receipt?.error_class === "classifier_timeout");
  assert(!JSON.stringify(result).includes("secret"));
});
