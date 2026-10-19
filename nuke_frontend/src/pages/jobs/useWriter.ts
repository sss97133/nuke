import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { obj, signTerms, type JobAction, type JsonObject } from './jobRead';
import { refusal } from './signDrafts';

/** One writer call from a confirm button: busy while it runs, the server's answer when it lands, its refusal in words otherwise. */
export function useWriter() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<JsonObject | null>(null);
  const run = async (rpc: string, args: object): Promise<boolean> => {
    setFailure(null);
    setBusy(true);
    const { data, error } = await supabase.rpc(rpc, args);
    setBusy(false);
    if (error) { setFailure(refusal(error)); return false; }
    setDone(obj(data) ?? {});
    return true;
  };
  return { busy, failure, setFailure, done, run };
}

/** The server's words for what signing says and does not, else the writer's documented terms. */
export const termsOf = (a: JobAction) => signTerms(a);
