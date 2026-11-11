import { isLoginPage } from "./batFetcher.ts";
import { fetchPage } from "./hybridFetcher.ts";

Deno.test("ordinary vehicle bodywork text is retained while actual denial signals stay rejected", async () => {
  const original = globalThis.fetch;
  const padding = "Vehicle description ".repeat(100);
  const body = `<title>Classic car auction</title><p>The body panels were primed, blocked, and finished in metallic blue.</p>${padding}`;
  try {
    globalThis.fetch = async () => new Response(body);
    if ((await fetchPage("https://example.com/auction", { publicOnly: true })).html !== body)
      throw new Error("ordinary bodywork testimony discarded");
    for (const denial of ["<h1>Blocked</h1>", "<p>Your request has been blocked</p>", "<p>Access denied</p>"]) {
      globalThis.fetch = async () => new Response(denial + padding);
      if ((await fetchPage("https://example.com/auction", { publicOnly: true })).html !== null)
        throw new Error("actual denial accepted: " + denial);
    }
    for (const status of [401, 403, 429]) {
      globalThis.fetch = async () => new Response(body, { status });
      if ((await fetchPage("https://example.com/auction", { publicOnly: true })).html !== null)
        throw new Error("HTTP refusal accepted: " + status);
    }
  } finally { globalThis.fetch = original; }
});

Deno.test("public auction bidding and registration prompts are not a login gate", () => {
  const html = `<html><title>1965 Porsche 911 2.0 SWB - LHD For Sale by Auction | Collecting Cars</title>
    <a href="/login">Sign in to bid</a><a href="/register">Create an account</a>
    <h1>1965 Porsche 911 2.0 SWB</h1><p>Current bid £17,250 · 8 bids</p>
    <button>Bid History</button><textarea name="placeBid">17500</textarea></html>`;
  if (isLoginPage(html)) throw new Error("public lot falsely rejected");
});

Deno.test("block classification handles malformed script endings without joining tokens or rewriting source", async () => {
  const original = globalThis.fetch;
  const padding = "Auction listing ".repeat(100);
  try {
    for (const fragment of [
      `<script>payment blocked</script\t\n bar>`,
      `<script>payment blocked</script/>`,
      `blo<script>translation</script>cked`,
      `<scr<script>payment blocked</script>ipt>`,
    ]) {
      const body = `<title>Porsche auction</title>${fragment}${padding}`;
      globalThis.fetch = async () => new Response(body);
      const result = await fetchPage("https://collectingcars.com/for-sale/porsche", { publicOnly: true });
      if (result.html !== body) throw new Error("classification joined tokens or altered original source");
    }
    const refusedBody = `<script>dictionary</script\t\n bar><h1>You have been blocked</h1>${padding}`;
    globalThis.fetch = async () => new Response(refusedBody);
    if ((await fetchPage("https://collectingcars.com/for-sale/porsche", { publicOnly: true })).html !== null) {
      throw new Error("visible block page after malformed script ending accepted");
    }
  } finally { globalThis.fetch = original; }
});

Deno.test("actual credential forms and explicit login gates remain rejected", () => {
  for (const html of [
    `<form id="login-form"></form>`,
    `<form action="/login"></form>`,
    `<title>Sign in to Collecting Cars</title>`,
    `<div id="auth0-lock-container"></div>`,
    `<input type="password"><p>Forgot password?</p>`,
    `<input type='password'><p>Sign in to continue</p>`,
    `<input type=password><p>Create an account</p>`,
  ]) if (!isLoginPage(html)) throw new Error(`login gate accepted: ${html}`);
});

Deno.test("script strings resembling password inputs do not supply an HTML input", () => {
  if (isLoginPage(`<script>const field = 'type="password"';</script><p>Register or sign in to bid</p>`)) {
    throw new Error("navigation and script configuration falsely rejected");
  }
});

Deno.test("public fetch retains auction HTML containing unrelated payment translations", async () => {
  const original = globalThis.fetch;
  const page = `<title>Porsche auction</title><p>Sign in to bid or register</p>
    <script>self.__next_f.push([1,"contact your bank if the payment has been blocked"])</script>
    <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
    <main>${"Auction description ".repeat(100)}</main>`;
  try {
    globalThis.fetch = async () => new Response(page);
    const result = await fetchPage("https://collectingcars.com/for-sale/porsche", { publicOnly: true });
    if (result.html !== page || result.authRequired || result.error) throw new Error("public HTML discarded");
    for (const body of [
      `<h1>Access Denied</h1>${"x".repeat(1100)}`,
      `<h1>You have been blocked</h1>${"x".repeat(1100)}`,
      `<title>Just a moment...</title>${"x".repeat(1100)}`,
      `<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>${"x".repeat(1100)}`,
      `<title>Sign in</title>${"x".repeat(1100)}`,
    ]) {
      globalThis.fetch = async () => new Response(body);
      const refused = await fetchPage("https://collectingcars.com/for-sale/porsche", { publicOnly: true });
      if (refused.html !== null) throw new Error("challenge/login content accepted");
    }
  } finally { globalThis.fetch = original; }
});
