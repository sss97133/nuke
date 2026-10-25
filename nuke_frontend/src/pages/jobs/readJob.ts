import { supabase } from '../../lib/supabase';
import { obj, readFailure, type JsonObject } from './jobRead';
import { takeWarm } from './jobWarm';

export type Load = { status: 'loading' } | { status: 'loaded'; data: JsonObject } | { status: 'failed'; reason: string };

/** One open reader call: its object, or the reason it failed in words a person can act on. */
export async function readJob(rpc: string, args: Record<string, unknown>, viewerId?: string | null): Promise<Load> {
  try {
    const { data, error } = await (takeWarm(rpc, args, viewerId) ?? supabase.rpc(rpc, args));
    if (error) return { status: 'failed', reason: readFailure(error) };
    const o = obj(data);
    return o ? { status: 'loaded', data: o } : { status: 'failed', reason: 'The reader returned nothing.' };
  } catch (e) {
    return { status: 'failed', reason: readFailure(e) };
  }
}
