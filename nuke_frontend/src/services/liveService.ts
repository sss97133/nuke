import { supabase } from '../lib/supabase';

export type LiveStatus = {
  live: boolean;
  startedAt?: string | null;
  nextStart?: string | null;
  viewerCount?: number;
};

// Provide a value export with the same name to avoid runtime import errors
// if any module accidentally imports { LiveStatus } as a value instead of type.
// This keeps the app from failing hard while remaining functionally harmless.
export const LiveStatus: LiveStatus = { live: false, nextStart: null };

// Toggle this to true once the live-admin edge function is deployed with proper CORS.
// While false, all methods skip the broken edge function call entirely to avoid
// CORS-induced delays on the profile page.
const LIVE_ADMIN_ENABLED = false;

export const LiveService = {
  async getStatus(userId: string): Promise<LiveStatus> {
    if (LIVE_ADMIN_ENABLED) {
      try {
        const { data, error } = await supabase.functions.invoke('live-admin', {
          body: { action: 'status', userId },
        });
        if (error) throw error;
        if (data && typeof data.live === 'boolean') {
          return {
            live: !!data.live,
            startedAt: data.startedAt ?? null,
            nextStart: data.nextStart ?? null,
            viewerCount: data.viewerCount ?? undefined,
          } as LiveStatus;
        }
      } catch (e) {
        // fall through to local fallback
      }
    }
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(`live_status_${userId}`) : null;
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { live: false, nextStart: null };
  },

  async getPlaybackUrl(userId: string): Promise<string | null> {
    if (LIVE_ADMIN_ENABLED) {
      try {
        const { data, error } = await supabase.functions.invoke('live-admin', {
          body: { action: 'playback', userId },
        });
        if (error) throw error;
        if (data && typeof data.playbackUrl === 'string') return data.playbackUrl as string;
      } catch (e) {
        // fallback
      }
    }
    const raw = typeof window !== 'undefined' ? localStorage.getItem(`live_playback_${userId}`) : null;
    return raw || null;
  },

  async start(userId: string): Promise<{ ok: boolean; message?: string }> {
    if (!LIVE_ADMIN_ENABLED) return { ok: false, message: 'Live streaming is not yet available' };
    const { data, error } = await supabase.functions.invoke('live-admin', {
      body: { action: 'start', userId },
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: data?.message };
  },

  async stop(userId: string): Promise<{ ok: boolean; message?: string }> {
    if (!LIVE_ADMIN_ENABLED) return { ok: false, message: 'Live streaming is not yet available' };
    const { data, error } = await supabase.functions.invoke('live-admin', {
      body: { action: 'stop', userId },
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: data?.message };
  },

  async getSettings(userId: string): Promise<any> {
    if (!LIVE_ADMIN_ENABLED) return {};
    const { data, error } = await supabase.functions.invoke('live-admin', {
      body: { action: 'settings', userId },
    });
    if (error) throw error;
    return data || {};
  },

  async updateSettings(userId: string, payload: Record<string, any>): Promise<{ ok: boolean; message?: string }> {
    if (!LIVE_ADMIN_ENABLED) return { ok: false, message: 'Live streaming is not yet available' };
    const { data, error } = await supabase.functions.invoke('live-admin', {
      body: { action: 'update-settings', userId, payload },
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: data?.message };
  },
};
