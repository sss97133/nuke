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
    if (error) throw error;
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

  async listActionsForPacks(packIds: string[]): Promise<StreamAction[]> {
    if (!packIds.length) return [];
    const { data, error } = await supabase
      .from('stream_actions')
      .select('id, pack_id, slug, title, kind, render_text, image_url, sound_key, duration_ms, cooldown_ms, is_active')
      .in('pack_id', packIds)
      .eq('is_active', true)
      .order('title', { ascending: true });
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
};


