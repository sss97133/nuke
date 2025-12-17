import { supabase } from '../lib/supabase';

export const StreamTipService = {
  async tipStream(streamId: string, amountCents: number, message?: string | null) {
    const { data, error } = await supabase.rpc('tip_live_stream', {
      p_stream_id: streamId,
      p_amount_cents: amountCents,
      p_message: message || null,
    });
    if (error) throw error;
    return data as string; // tip event id
  },
};




