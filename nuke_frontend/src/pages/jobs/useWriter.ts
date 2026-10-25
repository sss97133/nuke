import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { obj, signTerms, type JobAction, type JsonObject } from './jobRead';
import { refusal } from './signDrafts';

/** One writer call from a confirm button: busy while it runs, the server's answer when it lands, its refusal in words otherwise. */
export function useWriter(validateResult?: (data: unknown) => string | null) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<JsonObject | null>(null);
  const inFlight = useRef(false);
  const run = async (rpc: string, args: object): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setFailure(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc(rpc, args);
      if (error) { setFailure(refusal(error)); return false; }
      const resultFailure = validateResult?.(data);
      if (resultFailure) { setFailure(resultFailure); return false; }
      setDone(obj(data) ?? {});
      return true;
    } catch (error) {
      setFailure(refusal(error));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { busy, failure, setFailure, done, run };
}

/** The server's words for what signing says and does not, else the writer's documented terms. */
export const termsOf = (a: JobAction) => signTerms(a);
