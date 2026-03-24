/**
 * Instagram OAuth Callback
 *
 * Handles the Instagram Login OAuth redirect.
 * Exchanges code for short-lived token, then long-lived token (60 days).
 * Stores token in external_identities for the nukeltd IG account.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(
      `<html><body><h1>Instagram Auth Failed</h1><pre>${error}: ${url.searchParams.get("error_description")}</pre></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  if (!code) {
    return new Response(
      `<html><body><h1>No code received</h1></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  try {
    const IG_APP_ID = Deno.env.get("INSTAGRAM_APP_ID") || "1886021738767210";
    const IG_APP_SECRET = Deno.env.get("FACEBOOK_APP_SECRET") ?? "";
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ig-oauth-callback`;

    // Step 1: Exchange code for short-lived token
    const tokenRes = await fetch(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: IG_APP_ID,
          client_secret: IG_APP_SECRET,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code,
        }),
      },
    );

    const tokenData = await tokenRes.json();

    if (tokenData.error_type || tokenData.error_message) {
      throw new Error(`Token exchange: ${tokenData.error_message || JSON.stringify(tokenData)}`);
    }

    const shortToken = tokenData.access_token;
    const igUserId = tokenData.user_id?.toString();

    // Step 2: Exchange for long-lived token (60 days)
    const llRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_APP_SECRET}&access_token=${shortToken}`,
    );

    const llData = await llRes.json();

    if (llData.error) {
      throw new Error(`Long-lived token: ${llData.error.message}`);
    }

    const longToken = llData.access_token;
    const expiresIn = llData.expires_in || 5184000;

    // Step 3: Get IG user profile
    const profileRes = await fetch(
      `https://graph.instagram.com/v25.0/me?fields=user_id,username,name,account_type,profile_picture_url&access_token=${longToken}`,
    );

    const profile = await profileRes.json();

    // Step 4: Store in external_identities
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Update the existing nukeltd identity
    const { data: updated, error: updateErr } = await supabase
      .from("external_identities")
      .update({
        metadata: {
          access_token: longToken,
          token_expires_at: expiresAt,
          ig_user_id: igUserId || profile.user_id?.toString(),
          username: profile.username,
          account_type: profile.account_type,
          profile_picture_url: profile.profile_picture_url,
          app_id: IG_APP_ID,
        },
      })
      .eq("platform", "instagram")
      .eq("handle", "nukeltd")
      .select()
      .single();

    if (updateErr) {
      // Try by any instagram identity
      const { error: fallbackErr } = await supabase
        .from("external_identities")
        .update({
          handle: profile.username || "nukeltd",
          metadata: {
            access_token: longToken,
            token_expires_at: expiresAt,
            ig_user_id: igUserId || profile.user_id?.toString(),
            username: profile.username,
            account_type: profile.account_type,
            profile_picture_url: profile.profile_picture_url,
            app_id: IG_APP_ID,
          },
        })
        .eq("id", "c5c43f77-3e0a-4a5a-80a0-2ab9a0b3f05b");

      if (fallbackErr) {
        throw new Error(`DB update failed: ${fallbackErr.message}`);
      }
    }

    // Enable in patient_zero_config
    await supabase
      .from("patient_zero_config")
      .update({ enabled: true, paused: false, updated_at: new Date().toISOString() })
      .eq("external_identity_id", "c5c43f77-3e0a-4a5a-80a0-2ab9a0b3f05b");

    // Send Telegram notification
    const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const tgChat = Deno.env.get("TELEGRAM_CHAT_ID");
    if (tgToken && tgChat) {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgChat,
          text: `✅ Instagram connected!\n\nAccount: @${profile.username || "nukeltd"}\nType: ${profile.account_type}\nToken expires: ${expiresAt}\n\nPatient Zero IG publishing is now ENABLED.`,
          parse_mode: "HTML",
        }),
      });
    }

    return new Response(
      `<html><body style="font-family:monospace;padding:40px">
        <h1>Instagram Connected</h1>
        <p>Account: <b>@${profile.username || "unknown"}</b></p>
        <p>Type: ${profile.account_type}</p>
        <p>User ID: ${igUserId || profile.user_id}</p>
        <p>Token expires: ${expiresAt}</p>
        <p>Patient Zero IG publishing: <b>ENABLED</b></p>
        <br><p>You can close this tab.</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  } catch (err: any) {
    console.error("[ig-oauth-callback]", err);
    return new Response(
      `<html><body style="font-family:monospace;padding:40px">
        <h1>Error</h1>
        <pre>${err.message}</pre>
      </body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }
});
