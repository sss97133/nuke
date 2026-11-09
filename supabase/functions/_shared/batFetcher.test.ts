import { isLoginPage } from "./batFetcher.ts";

Deno.test("public auction bidding and registration prompts are not a login gate", () => {
  const html = `<html><title>1965 Porsche 911 2.0 SWB - LHD For Sale by Auction | Collecting Cars</title>
    <a href="/login">Sign in to bid</a><a href="/register">Create an account</a>
    <h1>1965 Porsche 911 2.0 SWB</h1><p>Current bid £17,250 · 8 bids</p>
    <button>Bid History</button><textarea name="placeBid">17500</textarea></html>`;
  if (isLoginPage(html)) throw new Error("public lot falsely rejected");
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
