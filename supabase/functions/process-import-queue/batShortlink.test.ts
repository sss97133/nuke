import { resolveBatQueueUrl } from "./batShortlink.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}
function fakeFetch(status: number, finalUrl: string): typeof fetch {
  return ((_input: unknown, _init?: unknown) =>
    Promise.resolve(
      Object.defineProperty(new Response("x", { status }), "url", {
        value: finalUrl,
      }),
    )) as typeof fetch;
}

Deno.test("non-BaT URL is left to the existing router", async () => {
  assert(
    (await resolveBatQueueUrl(
      "https://carsandbids.com/auctions/35nB6lll/x",
    )) === null,
    "null",
  );
});

Deno.test("a /listing/ URL is canonicalised without a fetch", async () => {
  const r = await resolveBatQueueUrl(
    "https://www.bringatrailer.com/listing/1995-porsche-911-carrera-coupe-125",
    () => {
      throw new Error("must not fetch");
    },
  );
  assert(
    r?.kind === "lot" &&
      r.url ===
        "https://bringatrailer.com/listing/1995-porsche-911-carrera-coupe-125/",
    JSON.stringify(r),
  );
});

Deno.test("the Nov 5 shortlink: a 404 post is dead (terminal), not retried", async () => {
  const r = await resolveBatQueueUrl(
    "https://bringatrailer.com/?post_type=bat-listing&p=126086136",
    fakeFetch(404, "https://bringatrailer.com/?p=126086136"),
  );
  assert(r?.kind === "dead" && r.http_status === 404, JSON.stringify(r));
});

Deno.test("a live shortlink resolves to its lot", async () => {
  const r = await resolveBatQueueUrl(
    "https://bringatrailer.com/?post_type=bat-listing&p=1234567",
    fakeFetch(
      200,
      "https://bringatrailer.com/listing/2011-porsche-911-gt3-rs-49/",
    ),
  );
  assert(
    r?.kind === "lot" &&
      r.url === "https://bringatrailer.com/listing/2011-porsche-911-gt3-rs-49/",
    JSON.stringify(r),
  );
});

Deno.test("a 5xx is unresolved (transient), not dead", async () => {
  const r = await resolveBatQueueUrl(
    "https://bringatrailer.com/?p=1234567",
    fakeFetch(503, "https://bringatrailer.com/?p=1234567"),
  );
  assert(r?.kind === "unresolved", JSON.stringify(r));
});
