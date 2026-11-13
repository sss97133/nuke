// Offline source-to-provider-input contracts. No network or provider calls.
import { fetchClassifierImage, jpegRenderUrl } from "./classifierImage.ts";
import { CLASSIFIER_BUDGET } from "./classifierBase.ts";
function assert(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
const source = "https://storage.example/storage/v1/object/public/vehicle-photos/frame.HEIC";

Deno.test("classifier transforms preserve the whole frame and bound both dimensions", () => {
  for (const side of [1600, 1024]) {
    const u = new URL(jpegRenderUrl(source, side, 70)!);
    assert(u.pathname === "/storage/v1/render/image/public/vehicle-photos/frame.HEIC", "same original object");
    assert(u.searchParams.get("resize") === "contain", "never use the default crop");
    assert(u.searchParams.get("width") === String(side) && u.searchParams.get("height") === String(side), "landscape and portrait bounded");
  }
  assert(jpegRenderUrl("https://other.example/frame.jpg") === null, "external originals are not redirected");
  assert(jpegRenderUrl("invalid") === null, "malformed sources stay refused");
});

Deno.test("the smaller-image retry retains whole-frame semantics and records its new input method", async () => {
  const requests: URL[] = [];
  const result = await fetchClassifierImage(source, (async input => {
    const u = new URL(String(input)); requests.push(u);
    assert(u.searchParams.get("resize") === "contain", "each provider input is uncropped");
    return requests.length === 1
      ? new Response(new Uint8Array([1]), { headers: { "content-type": "image/jpeg", "content-length": String(CLASSIFIER_BUDGET.image_bytes + 1) } })
      : new Response(new Uint8Array([3, 4]), { headers: { "content-type": "image/jpeg" } });
  }) as typeof fetch, false);
  assert(requests.length === 2 && requests[1].searchParams.get("width") === "1024" && requests[1].searchParams.get("height") === "1024", "bounded smaller retry");
  assert(result.resized === "render_1024_contain" && result.bytes[0] === 3, "receipt identifies the changed provider input");
});

Deno.test("renderer refusal retains the original-source fallback without manufacturing a transform receipt", async () => {
  const requests: string[] = [];
  const result = await fetchClassifierImage(source, (async input => {
    requests.push(String(input));
    return requests.length === 1 ? new Response(null, { status: 404 })
      : new Response(new Uint8Array([9]), { headers: { "content-type": "image/heic" } });
  }) as typeof fetch, true);
  assert(requests.length === 2 && requests[1] === source, "same original used");
  assert(result.mimeType === "image/heic" && !result.resized, "original bytes keep their actual method");
});
