import { captureTrustedJPEGInputs, captureVisionInputs, runCapturedVision, runPinnedVision, visionInputSHA256, VISION_INPUT_LIMITS,
  type VisionInputSource } from "./inputCustody.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII="), char => char.charCodeAt(0));
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0xff, 0xd9]);
const source = (key: string, extra: Partial<VisionInputSource> = {}): VisionInputSource => ({
  key, image_id: `image-${key}`, source_url: `https://fixture.invalid/${key}`, representation: "source", ...extra,
});
const response = (bytes = png, mime = "image/png", headers: Record<string, string> = {}) =>
  new Response(bytes, { headers: { "content-type": mime, ...headers } });
const allParts = (capture: Awaited<ReturnType<typeof captureVisionInputs>>) =>
  capture.inputs.map(input => ({ image_key: input.key }));
const modelResult = { provider: "injected-provider", model: "injected-model", keySource: "user", data: { outcome: "unknown" } };

Deno.test("model helper consumes exact pinned bytes once even if the source later changes", async () => {
  const expected = await visionInputSHA256(png), calls: string[] = [];
  let modelCalls = 0;
  const result = await runPinnedVision([source("query", { required: true, expected_source_sha256: expected.toUpperCase() })],
    allParts, async options => {
      modelCalls++;
      equal(options.maxTokens, 400);
      for (const part of options.parts) if ("imageUrl" in part) {
        // This is the shared helper's local data: decode, not a second remote fetch.
        const consumed = new Uint8Array(await (await fetch(part.imageUrl)).arrayBuffer());
        equal(await visionInputSHA256(consumed), expected);
        equal(Array.from(consumed), Array.from(png));
      }
      return modelResult;
    }, { fetch: async input => { calls.push(String(input)); return response(calls.length === 1 ? png : jpeg); } });
  equal(calls, ["https://fixture.invalid/query"]);
  equal(modelCalls, 1);
  equal(result.model_result, modelResult);
  equal(result.submitted_keys, ["query"]);
  equal(result.capture.inputs[0].receipt.input_sha256, expected);
  equal(result.capture.inputs[0].receipt.source_bytes_qualified, true);
  equal(result.capture.inputs[0].receipt.mime_type, "image/png");
});

Deno.test("one capture snapshot is reused for duplicate URLs while source expectations remain separate", async () => {
  let calls = 0;
  const expected = await visionInputSHA256(png);
  const result = await captureVisionInputs([
    source("query", { required: true, expected_source_sha256: expected }),
    source("reference", { source_url: "https://fixture.invalid/query", expected_source_sha256: "a".repeat(64) }),
    source("same-bytes", { source_url: "https://fixture.invalid/query", expected_source_sha256: expected }),
  ], { fetch: async () => { calls++; return response(); } });
  equal(calls, 1);
  equal(result.inputs.map(input => input.key), ["query", "same-bytes"]);
  equal(result.unavailable[0].code, "input_sha256_mismatch");
  equal(result.unavailable[0].observed_input_sha256, expected);
  equal(result.bytes_read, png.length);
});

Deno.test("changed required source bytes refuse model submission", async () => {
  let modelCalls = 0;
  const result = await runPinnedVision([source("query", { required: true, expected_source_sha256: "a".repeat(64) })],
    allParts, async () => { modelCalls++; return modelResult; }, { fetch: async () => response() });
  equal(modelCalls, 0);
  equal(result.refusal, "required_input_unavailable");
  equal(result.capture.required_available, false);
  equal(result.capture.unavailable[0].code, "input_sha256_mismatch");
});

Deno.test("missing and legacy source hashes retain measured input identity without qualification", async () => {
  const expected = await visionInputSHA256(png);
  for (const expected_source_sha256 of [undefined, null, "b".repeat(32), "not-a-hash"]) {
    const result = await captureVisionInputs([source("query", { expected_source_sha256 })], { fetch: async () => response() });
    equal(result.inputs[0].receipt.input_sha256, expected);
    equal(result.inputs[0].receipt.expected_source_sha256, null);
    equal(result.inputs[0].receipt.source_bytes_qualified, false);
  }
});

Deno.test("explicit derivative bytes never masquerade as original-source identity", async () => {
  const originalHash = await visionInputSHA256(jpeg), derivativeHash = await visionInputSHA256(png);
  const calls: string[] = [];
  const result = await captureVisionInputs([source("query", { representation: "derivative",
    input_url: "https://fixture.invalid/explicit-render", expected_source_sha256: originalHash,
    expected_input_sha256: derivativeHash })], { fetch: async input => { calls.push(String(input)); return response(); } });
  const receipt = result.inputs[0].receipt;
  equal(calls, ["https://fixture.invalid/explicit-render"]);
  equal(receipt.input_sha256, derivativeHash);
  equal(receipt.expected_source_sha256, originalHash);
  equal(receipt.representation, "derivative");
  equal(receipt.source_bytes_qualified, false);
  equal(receipt.derivation_qualified, false);
});

Deno.test("source representation cannot silently substitute a thumbnail URL", async () => {
  let calls = 0;
  const result = await captureVisionInputs([source("query", { input_url: "https://fixture.invalid/thumbnail" })],
    { fetch: async () => { calls++; return response(); } });
  equal(calls, 0);
  equal(result.unavailable[0].code, "source_representation_url_mismatch");
});

Deno.test("missing reference stays explicitly unavailable and cannot enter provider parts", async () => {
  const result = await runPinnedVision([source("query", { required: true }), source("missing-reference")], allParts,
    async options => {
      equal(options.parts.length, 1);
      equal("imageUrl" in options.parts[0] && options.parts[0].imageUrl.startsWith("data:image/png;base64,"), true);
      return modelResult;
    }, { fetch: async input => String(input).endsWith("missing-reference") ? new Response(null, { status: 404 }) : response() });
  equal(result.capture.unavailable, [{ key: "missing-reference", image_id: "image-missing-reference", required: false, code: "input_http_error" }]);
  equal(result.submitted_keys, ["query"]);
  const refused = await runPinnedVision([source("query", { required: true }), source("missing-reference")],
    () => [{ image_key: "missing-reference" }], async () => { throw new Error("must not run"); },
    { fetch: async input => String(input).endsWith("missing-reference") ? new Response(null, { status: 404 }) : response() });
  equal(refused.refusal, "uncaptured_input_requested");
});

Deno.test("missing required query or omitting it from parts prevents any provider call", async () => {
  let modelCalls = 0;
  for (const queryAvailable of [false, true]) {
    const result = await runPinnedVision([source("query", { required: true }), source("reference")],
      () => [{ image_key: "reference" }], async () => { modelCalls++; return modelResult; },
      { fetch: async input => !queryAvailable && String(input).endsWith("query") ? new Response(null, { status: 404 }) : response() });
    equal(result.refusal, queryAvailable ? "required_input_omitted" : "required_input_unavailable");
  }
  equal(modelCalls, 0);
});

Deno.test("redirects, unsupported media, fake image payloads and URL schemes refuse before model", async () => {
  const cases = [
    { make: () => new Response(null, { status: 302, headers: { location: "https://fixture.invalid/elsewhere" } }), code: "input_redirect_refused" },
    { make: () => response(png, "text/html"), code: "input_mime_invalid" },
    { make: () => response(new TextEncoder().encode("<html>not an image</html>")), code: "input_signature_invalid" },
    { make: () => response(new Uint8Array()), code: "input_empty" },
  ];
  for (const entry of cases) {
    const result = await captureVisionInputs([source("query")], { fetch: async (_url, options) => {
      equal(options?.redirect, "error"); return entry.make();
    } });
    equal(result.unavailable[0].code, entry.code);
    equal(result.inputs.length, 0);
  }
  const result = await captureVisionInputs([source("query", { source_url: "file:///private/source" })],
    { fetch: async () => { throw new Error("must not fetch"); } });
  equal(result.unavailable[0].code, "input_url_invalid");
});

Deno.test("declared and streamed image sizes are bounded before admission", async () => {
  const declared = await captureVisionInputs([source("query")],
    { limits: { image_bytes: 12 }, fetch: async () => response(png, "image/png", { "content-length": String(png.length) }) });
  equal(declared.unavailable[0].code, "input_bytes_exceeded");
  equal(declared.bytes_read, 0);
  const streamed = await captureVisionInputs([source("query")], { limits: { image_bytes: 12 }, fetch: async () =>
    new Response(new ReadableStream({ start(controller) {
      controller.enqueue(png.slice(0, 8)); controller.enqueue(png.slice(8, 16)); controller.close();
    } }), { headers: { "content-type": "image/png" } }) });
  equal(streamed.unavailable[0].code, "input_bytes_exceeded");
  equal(streamed.inputs.length, 0);
});

Deno.test("aggregate byte budget reserves the required query ahead of optional references", async () => {
  const calls: string[] = [];
  const result = await captureVisionInputs([source("reference"), source("query", { required: true })],
    { limits: { total_bytes: png.length }, fetch: async input => { calls.push(String(input)); return response(); } });
  equal(calls, ["https://fixture.invalid/query"]);
  equal(result.inputs.map(input => input.key), ["query"]);
  equal(result.unavailable[0].code, "input_total_bytes_exhausted");
  equal(result.required_available, true);
});

Deno.test("input and stage deadlines bound unresponsive fetches and streams", async () => {
  const hungFetch = await captureVisionInputs([source("query", { required: true })],
    { limits: { image_ms: 5, total_ms: 50 }, fetch: () => new Promise<Response>(() => {}) });
  equal(hungFetch.unavailable[0].code, "input_deadline_exceeded");
  const hungBody = await captureVisionInputs([source("query", { required: true })],
    { limits: { image_ms: 50, total_ms: 5 }, fetch: async () => new Response(new ReadableStream({ pull() {} }),
      { headers: { "content-type": "image/png" } }) });
  equal(hungBody.unavailable[0].code, "capture_deadline_exceeded");
});

Deno.test("limits can only decrease and duplicate keys or oversized input scopes never fetch", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return response(); };
  for (const attempt of [
    () => captureVisionInputs([source("query")], { fetch: fetcher, limits: { image_bytes: VISION_INPUT_LIMITS.image_bytes + 1 } }),
    () => captureVisionInputs([source("query")], { fetch: fetcher, limits: { output_tokens: 1601 } }),
    () => captureVisionInputs([source("query"), source("query")], { fetch: fetcher }),
    () => captureVisionInputs(Array.from({ length: 15 }, (_, i) => source(String(i))), { fetch: fetcher }),
  ]) {
    let refused = false;
    try { await attempt(); } catch { refused = true; }
    equal(refused, true);
  }
  equal(calls, 0);
});

Deno.test("repeated parts and duplicate-URL aliases cannot bypass the submitted-byte budget", async () => {
  let modelCalls = 0;
  const model = async () => { modelCalls++; return modelResult; };
  const repeated = await runPinnedVision([source("query", { required: true })],
    () => [{ image_key: "query" }, { image_key: "query" }], model, { fetch: async () => response() });
  equal(repeated.refusal, "input_repeated_in_submission");
  const aliases = await runPinnedVision([source("query", { required: true }),
    source("reference", { source_url: "https://fixture.invalid/query" })], allParts, model,
    { fetch: async () => response(), limits: { total_bytes: png.length } });
  equal(aliases.capture.inputs.length, 2);
  equal(aliases.refusal, "submission_bytes_exceeded");
  equal(modelCalls, 0);
});

Deno.test("provider unavailability and failures retain input custody without exposing provider prose", async () => {
  for (const throws of [false, true]) {
    const result = await runPinnedVision([source("query", { required: true })], allParts,
      async options => { equal(options.maxTokens, 200); if (throws) throw new Error("PRIVATE_PROVIDER_BODY"); return null; },
      { fetch: async () => response(), limits: { output_tokens: 200 } });
    equal(result.refusal, throws ? "provider_call_failed" : "provider_unavailable");
    equal(result.capture.inputs.length, 1);
    equal(result.submitted_keys, ["query"]);
    equal(JSON.stringify(result).includes("PRIVATE_PROVIDER_BODY"), false);
  }
});

const heic = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x68, 0x65, 0x69, 0x63]);
const project = "https://fixture.supabase.co";
async function nativeSource(extra: Partial<VisionInputSource> = {}): Promise<VisionInputSource> {
  const expected = await visionInputSHA256(heic);
  const storage_path = `users/11111111-1111-4111-8111-111111111111/capture-relay/${expected}/IMG_0001.HEIC`;
  return source("query", { required: true, expected_source_sha256: expected, storage_path,
    source_url: `${project}/storage/v1/object/public/vehicle-photos/${storage_path}`, ...extra });
}

Deno.test("trusted JPEG normalization retains separately verified original and consumed derivative identities", async () => {
  const original = await nativeSource(), calls: string[] = [];
  const capture = await captureTrustedJPEGInputs([original], project, { fetch: async (input, options) => {
    const url = String(input); calls.push(url);
    if (url.includes("/render/image/")) {
      equal(new Headers(options?.headers).get("Accept"), "image/jpeg");
      return response(jpeg, "image/jpeg");
    }
    return response(heic, "image/heic");
  } });
  equal(capture.required_available, true);
  equal(capture.bytes_read, heic.length + jpeg.length);
  const receipt = capture.inputs[0].receipt, sourceHash = await visionInputSHA256(heic), inputHash = await visionInputSHA256(jpeg);
  equal(receipt.source_qualified, true);
  equal(receipt.source_bytes_qualified, false);
  equal(receipt.source_sha256, sourceHash);
  equal(receipt.input_sha256, inputHash);
  equal(sourceHash === inputHash, false);
  equal(receipt.derivation_qualified, true);
  equal(receipt.derivation?.contract, "supabase_content_addressed_render_v1");
  equal(receipt.derivation?.source_object_path, `vehicle-photos/${original.storage_path}`);
  equal(receipt.derivation?.render_path, `/storage/v1/render/image/public/vehicle-photos/${original.storage_path}`);
  equal(receipt.derivation?.parameters, { width: 1600, height: 1600, resize: "contain", quality: 85 });
  equal(receipt.derivation?.source_sha256, sourceHash);
  equal(receipt.derivation?.input_sha256, inputHash);
  equal(calls, [original.source_url,
    `${project}${receipt.derivation?.render_path}?width=1600&height=1600&resize=contain&quality=85`]);
  const result = await runCapturedVision([original], capture, allParts, async options => {
    equal(options.maxTokens, 1600); // Explicit new-mode budget; old default remains400.
    for (const part of options.parts) if ("imageUrl" in part) {
      const consumed = new Uint8Array(await (await fetch(part.imageUrl)).arrayBuffer());
      equal(await visionInputSHA256(consumed), inputHash);
    }
    return modelResult;
  }, { limits: { output_tokens: 1600 } });
  equal(result.model_result, modelResult);
  equal(calls.length, 2); // Prepared input is not fetched a second time for the model.
});

Deno.test("normalization refuses unqualified or mismatched originals before asking the renderer", async () => {
  let calls = 0;
  const original = await nativeSource();
  const changed = await captureTrustedJPEGInputs([original], project,
    { fetch: async () => { calls++; return response(png); } });
  equal(changed.inputs.length, 0);
  equal(changed.unavailable[0].code, "input_sha256_mismatch");
  equal(calls, 1);
  const unqualified = await captureTrustedJPEGInputs([{ ...original, expected_source_sha256: "a".repeat(32) }], project,
    { fetch: async () => { calls++; return response(); } });
  equal(unqualified.unavailable[0].code, "normalization_source_unqualified");
  equal(calls, 1);
});

Deno.test("trusted derivation requires exact live storage path, content hash, project origin and canonical URL", async () => {
  const original = await nativeSource();
  const variants: VisionInputSource[] = [
    { ...original, storage_path: null },
    { ...original, storage_path: original.storage_path!.replace(/\/[a-f0-9]{64}\//, `/${"a".repeat(64)}/`) },
    { ...original, storage_path: [...original.storage_path!.split("/").slice(0, -1), "%2e%2e"].join("/") },
    { ...original, source_url: original.source_url.replace(project, "https://untrusted.invalid") },
    { ...original, source_url: original.source_url + "?unrecorded-transform=true" },
    { ...original, input_url: original.source_url + "?thumbnail=true" },
  ];
  let calls = 0;
  for (const variant of variants) {
    const result = await captureTrustedJPEGInputs([variant], project, { fetch: async () => { calls++; return response(); } });
    equal(result.inputs.length, 0);
    equal(result.required_available, false);
  }
  equal(calls, 0);
});

Deno.test("renderer must return actual JPEG; no format or provider fallback is performed", async () => {
  const original = await nativeSource(), calls: string[] = [];
  const result = await captureTrustedJPEGInputs([original], project, { fetch: async input => {
    calls.push(String(input)); return String(input).includes("/render/image/") ? response(png) : response(heic, "image/heic");
  } });
  equal(result.inputs.length, 0);
  equal(result.unavailable[0].code, "normalization_output_not_jpeg");
  equal(result.required_available, false);
  equal(calls.length, 2);
});

Deno.test("original verification and renderer share one total byte budget", async () => {
  const original = await nativeSource(); let calls = 0;
  const result = await captureTrustedJPEGInputs([original], project, { limits: { total_bytes: heic.length },
    fetch: async () => { calls++; return response(heic, "image/heic"); } });
  equal(calls, 1);
  equal(result.inputs.length, 0);
  equal(result.bytes_read, heic.length);
  equal(result.unavailable[0].code, "input_total_bytes_exhausted");
});
