import { supabase } from '../lib/supabase';

export type StreamActionPack = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  is_active: boolean;
};

export type StreamAction = {
  id: string;
  pack_id: string;
  slug: string;
  title: string;
  kind: 'text_popup' | 'image_popup' | 'sound_only' | 'combo';
  render_text: string | null;
  image_url: string | null;
  sound_key: string | null;
  duration_ms: number;
  cooldown_ms: number;
  is_active: boolean;
  source_url: string | null;
  attribution: string | null;
  license: string | null;
  tags: string[];
  metadata: Record<string, any>;
};

export type StreamActionPurchase = {
  id: string;
  user_id: string;
  pack_id: string;
  purchased_at: string;
  expires_at: string | null;
};

export type StreamActionEvent = {
  id: string;
  stream_id: string;
  action_id: string;
  sender_id: string | null;
  kind: StreamAction['kind'];
  title: string;
  render_text: string | null;
  image_url: string | null;
  sound_key: string | null;
  duration_ms: number;
  created_at: string;
};

export type ContentActionEvent = {
  id: string;
  target_key: string;
  vehicle_id: string | null;
  action_id: string;
  sender_id: string | null;
  kind: StreamAction['kind'];
  title: string;
  render_text: string | null;
  image_url: string | null;
  sound_key: string | null;
  duration_ms: number;
  cost_cents: number;
  created_at: string;
};

export const StreamActionsService = {
  async listPacks(): Promise<StreamActionPack[]> {
    const { data, error } = await supabase
      .from('stream_action_packs')
      .select('id, slug, name, description, price_cents, is_active')
      .eq('is_active', true)
      .order('price_cents', { ascending: true });
    if (error) {
      // In some environments this feature isn't deployed yet. "Blank is better than wrong/noisy."
      const status = (error as any)?.status ?? (error as any)?.statusCode;
      const code = String((error as any)?.code || '').toUpperCase();
      const msg = String((error as any)?.message || '').toLowerCase();
      if (status === 404 || code === '42P01' || msg.includes('does not exist') || msg.includes('not found')) return [];
      throw error;
    }
    return (data || []) as StreamActionPack[];
  },

  async listMyPurchases(userId: string): Promise<StreamActionPurchase[]> {
    const { data, error } = await supabase
      .from('stream_action_purchases')
      .select('id, user_id, pack_id, purchased_at, expires_at')
      .eq('user_id', userId);
    if (error) throw error;
    return (data || []) as StreamActionPurchase[];
  },

  async listActionsForPacks(packIds: string[], includeInactive = false): Promise<StreamAction[]> {
    if (!packIds.length) return [];
    let query = supabase
      .from('stream_actions')
      .select('id, pack_id, slug, title, kind, render_text, image_url, sound_key, duration_ms, cooldown_ms, is_active, source_url, attribution, license, tags, metadata')
      .in('pack_id', packIds);
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query.order('title', { ascending: true });
    if (error) throw error;
    return (data || []) as StreamAction[];
  },

  async listAllActions(includeInactive = false): Promise<StreamAction[]> {
    let query = supabase
      .from('stream_actions')
      .select('id, pack_id, slug, title, kind, render_text, image_url, sound_key, duration_ms, cooldown_ms, is_active, source_url, attribution, license, tags, metadata');
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query.order('title', { ascending: true });
    if (error) throw error;
    return (data || []) as StreamAction[];
  },

  async purchasePack(packId: string) {
    const { data, error } = await supabase.rpc('purchase_stream_action_pack', { p_pack_id: packId });
    if (error) throw error;
    return data;
  },

  async sendAction(streamId: string, actionId: string) {
    const { data, error } = await supabase.rpc('send_stream_action', {
      p_stream_id: streamId,
      p_action_id: actionId,
    });
    if (error) throw error;
    return data as string; // event id
  },

  async sendContentAction(targetKey: string, actionId: string) {
    const { data, error } = await supabase.rpc('send_content_action', {
      p_target_key: targetKey,
      p_action_id: actionId,
    });
    if (error) throw error;
    return data as string; // event id
  },

  async listMyContentActions(userId: string, limit = 100): Promise<ContentActionEvent[]> {
    const { data, error } = await supabase
      .from('content_action_events')
      .select('id, target_key, vehicle_id, action_id, sender_id, kind, title, render_text, image_url, sound_key, duration_ms, cost_cents, created_at')
      .eq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []) as ContentActionEvent[];
  },

  async deleteAction(actionId: string) {
    const { error } = await supabase.rpc('admin_delete_stream_action', { p_action_id: actionId });
    if (error) throw error;
  },

  async deletePack(packId: string) {
    const { error } = await supabase.rpc('admin_delete_stream_action_pack', { p_pack_id: packId });
    if (error) throw error;
  },

  async getVehicleMemeStats(vehicleId: string): Promise<{
    totalDrops: number;
    uniqueMemers: number;
    topMeme: { title: string; count: number } | null;
    recentDrops: ContentActionEvent[];
  }> {
    try {
      // Get all drops for this vehicle
      const { data, error } = await supabase
        .from('content_action_events')
        .select('id, title, sender_id, image_url, render_text, created_at')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      
      const drops = data || [];
      const totalDrops = drops.length;
      const uniqueMemers = new Set(drops.map(d => d.sender_id).filter(Boolean)).size;
      
      // Find top meme
      const memeCounts = new Map<string, number>();
      for (const d of drops) {
        memeCounts.set(d.title, (memeCounts.get(d.title) || 0) + 1);
      }
      
      let topMeme: { title: string; count: number } | null = null;
      for (const [title, count] of memeCounts.entries()) {
        if (!topMeme || count > topMeme.count) {
          topMeme = { title, count };
        }
      }

      return {
        totalDrops,
        uniqueMemers,
        topMeme,
        recentDrops: drops.slice(0, 5) as ContentActionEvent[],
      };
    } catch {
      return {
        totalDrops: 0,
        uniqueMemers: 0,
        topMeme: null,
        recentDrops: [],
      };
    }
  },

  async getVehicleDropCount(vehicleId: string): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('content_action_events')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId);
      
      if (error) return 0;
      return count || 0;
    } catch {
      return 0;
    }
  },
};


