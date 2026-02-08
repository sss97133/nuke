#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-run --allow-sys
/**
 * Facebook Relay Server
 *
 * Runs locally on a residential IP. Supabase edge functions call this
 * to resolve FB share links and scrape marketplace pages since Facebook
 * blocks all datacenter IPs. Also supports Playwright-based seller messaging.
 *
 * Start:  deno run --allow-net --allow-env --allow-read --allow-run --allow-sys scripts/fb-relay-server.ts
 * Expose: cloudflared tunnel --url http://localhost:8787
 * Then set FB_RELAY_URL in Supabase secrets to the tunnel URL.
 */

const PORT = parseInt(Deno.env.get("FB_RELAY_PORT") || "8787");
const AUTH_TOKEN = Deno.env.get("FB_RELAY_TOKEN") || "nuke-fb-relay-2026";

const BINGBOT_UA = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
const FACEBOT_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Health check
  if (url.pathname === "/health") {
    return Response.json({ ok: true, ts: new Date().toISOString() });
  }

  // Auth check
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (token !== AUTH_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "POST required" }, { status: 405 });
  }

  const body = await req.json();
  const targetUrl: string = body.url;
  const action: string = body.action || "scrape"; // "resolve" | "scrape"

  if (!targetUrl) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  console.log(`[${action}] ${targetUrl}`);

  try {
    if (action === "message") {
      // Send a message to a FB Marketplace seller via Playwright
      const messageText: string = body.message || "";
      if (!messageText) {
        return Response.json({ error: "message text required" }, { status: 400 });
      }

      const result = await sendFBMessage(targetUrl, messageText);
      return Response.json(result, { status: result.success ? 200 : 502 });
    }

    if (action === "resolve") {
      // Just follow redirects and return the final URL
      const resp = await fetch(targetUrl, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": FACEBOT_UA },
        signal: AbortSignal.timeout(12000),
      });
      const finalUrl = resp.url;
      // Also grab og:url from HTML as fallback
      const html = await resp.text();
      const ogUrl =
        html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        null;

      console.log(`  → resolved to: ${finalUrl}`);
      return Response.json({
        success: true,
        original_url: targetUrl,
        resolved_url: finalUrl,
        og_url: ogUrl,
        is_login: finalUrl.includes("/login"),
      });
    }

    // action === "scrape" — full scrape with Bingbot
    const resp = await fetch(targetUrl, {
      headers: { "User-Agent": BINGBOT_UA },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const html = await resp.text();
    const finalUrl = resp.url;

    // Extract key meta tags
    const extract = (prop: string) =>
      html.match(
        new RegExp(
          `<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`,
          "i"
        )
      )?.[1] ||
      html.match(
        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`,
          "i"
        )
      )?.[1] ||
      null;

    const ogTitle = extract("title");
    const ogDesc = extract("description");
    const ogImage = extract("image");
    const ogUrl = extract("url");
    const titleTag =
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || null;

    // Extract price from JSON-LD
    const priceMatch =
      html.match(/"amount_with_offset"[:\s]*\{"amount"[:\s]*"?(\d+)"?/i) ||
      html.match(/"price"[:\s]*\{[^}]*"amount"[:\s]*"?(\d+)"?/i);
    let price: number | null = null;
    if (priceMatch) {
      const num = parseInt(priceMatch[1], 10);
      price = num > 100000 ? Math.round(num / 100) : num;
      if (price < 50 || price > 1000000) price = null;
    }

    // Extract listing IDs from page
    const listingIds = [
      ...new Set(
        [...html.matchAll(/marketplace\/item\/(\d+)/g)].map((m) => m[1])
      ),
    ];

    console.log(
      `  → scraped: "${ogTitle || titleTag}" price=${price} listings=${listingIds.length}`
    );

    return Response.json({
      success: true,
      final_url: finalUrl,
      og_title: ogTitle,
      og_description: ogDesc,
      og_image: ogImage,
      og_url: ogUrl,
      title_tag: titleTag,
      price,
      listing_ids: listingIds,
      html_length: html.length,
      is_login: html.includes('id="loginform"') || finalUrl.includes("/login"),
    });
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    return Response.json(
      { success: false, error: err.message },
      { status: 502 }
    );
  }
}

// ============================================
// PLAYWRIGHT: FB SELLER MESSAGING
// ============================================

const FB_PROFILE_DIR = Deno.env.get("FB_PROFILE_DIR") ||
  `${Deno.env.get("HOME")}/.fb-playwright-profile`;

async function sendFBMessage(
  listingUrl: string,
  messageText: string,
): Promise<{ success: boolean; error?: string; details?: string }> {
  // Use a Node.js subprocess with Playwright since Deno doesn't natively support it
  const scriptPath = new URL("./fb-send-message.mjs", import.meta.url).pathname;

  try {
    const cmd = new Deno.Command("node", {
      args: [scriptPath, listingUrl, messageText, FB_PROFILE_DIR],
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(60000),
    });

    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);

    if (output.success) {
      try {
        return JSON.parse(stdout.trim().split("\n").pop()!);
      } catch {
        return { success: true, details: stdout.trim() };
      }
    } else {
      console.error("Playwright message script failed:", stderr);
      return { success: false, error: stderr.trim() || "Script failed" };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

console.log(`FB Relay Server listening on :${PORT}`);
console.log(`Auth token: ${AUTH_TOKEN}`);
console.log(`Actions: resolve, scrape, message`);
console.log(`Expose with: cloudflared tunnel --url http://localhost:${PORT}`);
Deno.serve({ port: PORT }, handleRequest);
