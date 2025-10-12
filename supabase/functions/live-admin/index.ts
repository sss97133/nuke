// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: live-admin
// Ensures a per-user Mux live stream and stores stream key + playback id in user_live_state

import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MUX_TOKEN_ID = Deno.env.get('MUX_TOKEN_ID')!;
const MUX_TOKEN_SECRET = Deno.env.get('MUX_TOKEN_SECRET')!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function ensureLiveStream(user_id: string) {
  // Check existing
  const { data: existing, error } = await supabaseAdmin
    .from('user_live_state')
    .select('user_id, mux_stream_id, mux_stream_key, mux_playback_id')
    .eq('user_id', user_id)
    .maybeSingle();
  if (error) throw error;
  if (existing && existing.mux_stream_key && existing.mux_playback_id) {
    return existing;
  }

  // Create Mux live stream
  const auth = 'Basic ' + btoa(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`);
  const res = await fetch('https://api.mux.com/video/v1/live-streams', {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playback_policy: ['public'],
      new_asset_settings: { playback_policy: ['public'] }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mux create live stream failed ${res.status}: ${text}`);
  }
  const json = await res.json();
  const ls = json?.data;
  const stream_id = ls?.id;
  const stream_key = ls?.stream_key;
  const playback_id = ls?.playback_ids?.[0]?.id;

  if (!stream_id || !stream_key || !playback_id) {
    throw new Error('Mux response missing fields');
  }

  // Upsert state
  const { data: up, error: upErr } = await supabaseAdmin
    .from('user_live_state')
    .upsert({
      user_id,
      mux_stream_id: stream_id,
      mux_stream_key: stream_key,
      mux_playback_id: playback_id
    }, { onConflict: 'user_id' })
    .select().maybeSingle();
  if (upErr) throw upErr;
  return up;
}

serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const allowedOrigins = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174'
  ]);

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400'
  } as const;

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { ...corsHeaders } });

    // Auth: require a logged-in user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Unauthorized', { status: 401, headers: { ...corsHeaders } });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response('Unauthorized', { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    const targetUserId = (body?.userId as string | undefined) || user.id;

    // Always ensure stream exists for owner on any action that needs settings/playback
    const ensureIfOwner = async () => {
      if (targetUserId === user.id) await ensureLiveStream(user.id);
    };

    const playbackUrlOf = (playback_id?: string | null) => playback_id ? `https://stream.mux.com/${playback_id}.m3u8` : null;

    switch (action) {
      case 'status': {
        const { data, error } = await supabase
          .from('user_live_state')
          .select('live, started_at, mux_playback_id')
          .eq('user_id', targetUserId)
          .maybeSingle();
        if (error) throw error;
        return new Response(JSON.stringify({
          live: !!data?.live,
          startedAt: data?.started_at ?? null,
          nextStart: null,
          playbackUrl: playbackUrlOf(data?.mux_playback_id)
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      case 'playback': {
        const { data, error } = await supabase
          .from('user_live_state')
          .select('mux_playback_id')
          .eq('user_id', targetUserId)
          .maybeSingle();
        if (error) throw error;
        return new Response(JSON.stringify({ playbackUrl: playbackUrlOf(data?.mux_playback_id) }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      case 'settings': {
        // Owner gets RTMP credentials; others get playback only
        if (targetUserId !== user.id) {
          const { data, error } = await supabase
            .from('user_live_state')
            .select('mux_playback_id')
            .eq('user_id', targetUserId)
            .maybeSingle();
          if (error) throw error;
          return new Response(JSON.stringify({ playbackUrl: playbackUrlOf(data?.mux_playback_id) }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        await ensureIfOwner();
        const { data, error } = await supabase
          .from('user_live_state')
          .select('mux_stream_key, mux_playback_id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (error) throw error;
        // Mux RTMP base
        const rtmpUrl = 'rtmps://global-live.mux.com:443/app';
        return new Response(JSON.stringify({
          rtmpUrl,
          streamKey: data?.mux_stream_key ?? null,
          playbackUrl: playbackUrlOf(data?.mux_playback_id)
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      case 'start': {
        if (targetUserId !== user.id) return new Response('Forbidden', { status: 403, headers: { ...corsHeaders } });
        await ensureIfOwner();
        const { error } = await supabase
          .from('user_live_state')
          .upsert({ user_id: user.id, live: true, started_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true, message: 'Stream marked live' }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      case 'stop': {
        if (targetUserId !== user.id) return new Response('Forbidden', { status: 403, headers: { ...corsHeaders } });
        const { error } = await supabase
          .from('user_live_state')
          .update({ live: false })
          .eq('user_id', user.id);
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true, message: 'Stream stopped' }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      case 'update-settings': {
        if (targetUserId !== user.id) return new Response('Forbidden', { status: 403, headers: { ...corsHeaders } });
        // Currently nothing to update beyond credentials (managed by Mux). Accept payload for future use.
        return new Response(JSON.stringify({ ok: true, message: 'No-op settings update' }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      default: {
        // Default behavior: ensure stream exists for owner
        if (targetUserId !== user.id) return new Response('Bad Request', { status: 400, headers: { ...corsHeaders } });
        const state = await ensureLiveStream(user.id);
        return new Response(JSON.stringify({ ok: true, state }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
});
