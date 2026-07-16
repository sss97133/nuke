/**
 * Vehicle Agent Chat
 *
 * Interactive Claude scoped to ONE vehicle. You message it; the vehicle's own data
 * (observations + deep-analyzed images) is the harness it reasons over, loaded
 * server-side by the `vehicle-agent` edge function. When the exchange establishes a
 * durable new fact, the agent records it as a provenance-stamped observation on your
 * behalf (rank 'normal', fully backtrackable) — surfaced here as a "recorded" note.
 *
 * Compute follows the user's analysis settings (their API key, else the platform key).
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  wrote?: Array<{ id: string; kind: string; content_text: string | null }>;
}

const VehicleAgentChat: React.FC<{ vehicleId: string }> = ({ vehicleId }) => {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [allowWrites, setAllowWrites] = useState(true);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, busy]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setError('');
    setBusy(true);
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: 'user', content: message }]);
    setInput('');
    try {
      const { data, error: e } = await supabase.functions.invoke('vehicle-agent', {
        body: { vehicle_id: vehicleId, message, history, allow_writes: allowWrites },
      });
      if (e) {
        const msg = (e as any)?.context?.body || e.message || 'Agent error';
        setError(typeof msg === 'string' ? msg : 'Agent error');
        setTurns((t) => [...t, { role: 'assistant', content: '(failed)' }]);
      } else {
        setTurns((t) => [...t, { role: 'assistant', content: data?.reply || '(no response)', wrote: data?.wrote }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent error');
    } finally {
      setBusy(false);
    }
  }, [input, busy, turns, vehicleId, allowWrites]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <CollapsibleWidget variant="profile" title="Ask the Vehicle Agent" defaultCollapsed={true}>
      <div style={{ fontFamily: 'Arial, sans-serif' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          Claude with this vehicle's data as context. It can record durable new facts as
          observations on your behalf — tracked and reversible.
        </div>

        {turns.length > 0 && (
          <div style={{ border: '2px solid var(--border)', maxHeight: 320, overflowY: 'auto', padding: 8, marginBottom: 8 }}>
            {turns.map((t, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 2 }}>
                  {t.role === 'user' ? 'You' : 'Agent'}
                </div>
                <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{t.content}</div>
                {t.wrote && t.wrote.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 10, color: 'var(--success, #4caf50)' }}>
                    ✓ recorded {t.wrote.length} observation{t.wrote.length > 1 ? 's' : ''}:{' '}
                    {t.wrote.map((w) => w.kind).join(', ')}
                  </div>
                )}
              </div>
            ))}
            {busy && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Thinking…</div>}
            <div ref={endRef} />
          </div>
        )}

        {error && (
          <div style={{ fontSize: 11, color: 'var(--error, #f44336)', marginBottom: 8 }}>{error}</div>
        )}

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about this vehicle… (Enter to send)"
          rows={2}
          style={{
            width: '100%', padding: 8, fontSize: 12, fontFamily: 'Arial, sans-serif',
            background: 'var(--bg-secondary)', border: '2px solid var(--border)', color: 'var(--text)', resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={allowWrites} onChange={(e) => setAllowWrites(e.target.checked)} />
            Let it record observations
          </label>
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            style={{
              background: 'var(--accent)', color: 'var(--bg)', border: 'none', padding: '8px 16px',
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              cursor: busy || !input.trim() ? 'default' : 'pointer', opacity: busy || !input.trim() ? 0.5 : 1,
            }}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </CollapsibleWidget>
  );
};

export default VehicleAgentChat;
