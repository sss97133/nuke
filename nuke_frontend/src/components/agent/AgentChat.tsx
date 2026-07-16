import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { CollapsibleWidget } from '../ui/CollapsibleWidget';
import { ASK_AGENT_EVENT } from './askAgent';
import { useBuildLedger } from '../../pages/vehicle-profile/hooks/useBuildLedger';

// The in-app two-way agent. Conversational face of the same verbs the drill buttons
// use: it lists the Build Ledger's open owner questions and signs them off through
// ingest-observation + supersede_observation. Backed by supabase/functions/agent-chat.
//
// Why a chat and not a form: the ledger's questions are heterogeneous — a yes/no
// ("was this $1,000 for the Mustang?"), an amount only the owner knows ("what did
// you pay Walter?"), and a choice between vehicles ("Mustang or C10?"). One
// conversation answers all three shapes, and the next thousand questions the
// receipt corpus raises need no new widget.

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
  /** Which credential ran this turn: subscription | user_api_key | system_api_key. */
  source?: string;
  chargedCents?: number;
  /** Set when the agent has no credential / no funds — we show the way out. */
  needsCredential?: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  subscription: 'ran on your Claude subscription',
  user_api_key: 'ran on your Anthropic API key',
  system_api_key: 'ran on Nuke’s key, billed to your balance',
};

// BuildLedger's NEEDS CONFIRMATION button dispatches ASK_AGENT_EVENT (see
// ./askAgent); the panel below listens. A window event rather than a new context
// provider: two siblings, one string.

interface Props {
  vehicleId: string;
}

const mono: React.CSSProperties = { fontFamily: 'var(--vp-font-mono)' };

const AgentChat: React.FC<Props> = ({ vehicleId }) => {
  // Same react-query key as BuildLedger (['build-ledger', vehicleId]) — served from
  // cache, not a second round-trip. The count is real or it isn't shown.
  const { data: ledger } = useBuildLedger(vehicleId);
  const pendingCount = ledger.pendingCount;
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const send = useCallback(async (text: string) => {
    const userInput = text.trim();
    if (!userInput || loading) return;

    const stamp = Date.now();
    const assistantId = `a-${stamp}`;
    // Snapshot the thread the model sees BEFORE this turn's placeholders exist.
    const history = messages
      .filter(m => !m.loading)
      .map(m => ({ role: m.role, content: m.content }));

    setInput('');
    setMessages(prev => [
      ...prev,
      { id: `u-${stamp}`, role: 'user', content: userInput },
      { id: assistantId, role: 'assistant', content: '', loading: true },
    ]);
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('agent-chat', {
        body: {
          messages: [...history, { role: 'user', content: userInput }],
          context: { vehicle_id: vehicleId },
        },
      });

      // A 402/429 carries a real explanation in its body; functions.invoke surfaces
      // non-2xx as an error and drops `data`. Read the body back off the Response.
      let payload = data;
      if (error) {
        const ctx = (error as { context?: Response }).context;
        try { payload = ctx ? await ctx.json() : null; } catch { payload = null; }
      }

      const reply = payload?.reply
        ?? (error ? `Couldn't reach the agent: ${error.message}` : 'No reply.');
      const needsCredential = payload?.error === 'no_credential'
        || payload?.error === 'needs_funding'
        || payload?.error === 'rate_limited';

      setMessages(prev => prev.map(m => (m.id === assistantId ? {
        ...m,
        content: reply,
        loading: false,
        source: payload?.source,
        chargedCents: payload?.charged_cents,
        needsCredential,
      } : m)));

      // A ruling landed — the ledger's rows, totals and pending count are all stale.
      const wrote = (payload?.actions ?? []).some(
        (a: { tool?: string; result?: { ok?: boolean } }) => a.tool === 'answer_confirmation' && a.result?.ok,
      );
      if (wrote) void queryClient.invalidateQueries({ queryKey: ['build-ledger', vehicleId] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, content: `Error: ${msg}`, loading: false } : m)));
    } finally {
      setLoading(false);
    }
  }, [loading, messages, vehicleId, queryClient]);

  // A Confirm click on a ledger row seeds the box and focuses it — it does NOT
  // auto-send. Signing is deliberate; the owner presses enter.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (!detail?.text) return;
      setInput(detail.text);
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ block: 'center' });
    };
    window.addEventListener(ASK_AGENT_EVENT, onAsk);
    return () => window.removeEventListener(ASK_AGENT_EVENT, onAsk);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <CollapsibleWidget
      variant="profile"
      title="Ask"
      defaultCollapsed={false}
      badge={
        pendingCount > 0
          ? <span className="widget__count" style={{ color: 'var(--vp-gulf-orange, #EE7623)' }}>{pendingCount} OPEN</span>
          : undefined
      }
    >
      <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: 1.6 }}>
        <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', marginBottom: '6px', lineHeight: 1.5 }}>
          Answers land as owner-signed testimony against this vehicle. Confirming an entry
          supersedes the draft; nothing is overwritten.
        </div>

        <div
          ref={scrollRef}
          style={{
            maxHeight: '320px', overflowY: 'auto', border: '2px solid var(--vp-ghost)',
            padding: '6px', marginBottom: '4px',
          }}
        >
          {messages.length === 0 ? (
            <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', lineHeight: 1.6 }}>
              {pendingCount > 0 ? (
                <>
                  <span style={{ ...mono, fontWeight: 700, color: 'var(--vp-gulf-orange, #EE7623)', letterSpacing: '0.1em' }}>
                    {pendingCount} {pendingCount === 1 ? 'ENTRY NEEDS' : 'ENTRIES NEED'} YOUR RULING
                  </span>
                  <div style={{ marginTop: '4px' }}>Ask “what needs my confirmation?” to walk them one at a time.</div>
                </>
              ) : (
                <div>Ask about this vehicle&rsquo;s ledger, photos, or history.</div>
              )}
            </div>
          ) : (
            messages.map(m => (
              <div key={m.id} style={{ marginBottom: '8px' }}>
                <div style={{
                  ...mono, fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em',
                  textTransform: 'uppercase', marginBottom: '2px',
                  color: m.role === 'user' ? 'var(--vp-pencil)' : 'var(--vp-ink)',
                }}>
                  {m.role === 'user' ? 'You' : 'Agent'}
                </div>
                <div style={{ fontSize: '9px', color: 'var(--vp-ink)', whiteSpace: 'pre-wrap' }}>
                  {m.loading
                    ? <span style={{ color: 'var(--vp-pencil)' }}>thinking…</span>
                    : m.content}
                </div>

                {/* Who paid for this turn. Never inferred — the function reports it. */}
                {!m.loading && m.source && SOURCE_LABEL[m.source] && (
                  <div style={{ ...mono, fontSize: '8px', color: 'var(--vp-pencil)', marginTop: '3px' }}>
                    {SOURCE_LABEL[m.source]}
                    {m.chargedCents ? ` · $${(m.chargedCents / 100).toFixed(2)}` : ''}
                  </div>
                )}

                {!m.loading && m.needsCredential && (
                  <a
                    href="/settings/ai"
                    style={{
                      ...mono, display: 'inline-block', marginTop: '4px', padding: '3px 8px',
                      fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                      border: '2px solid var(--vp-gulf-orange, #EE7623)',
                      color: 'var(--vp-gulf-orange, #EE7623)', textDecoration: 'none',
                    }}
                  >
                    Connect your Claude
                  </a>
                )}
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px', alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="What needs my confirmation?"
            disabled={loading}
            rows={1}
            style={{
              width: '100%', resize: 'none', padding: '4px 6px',
              border: '2px solid var(--vp-ghost)', background: 'transparent',
              color: 'var(--vp-ink)', fontFamily: 'var(--vp-font-sans)', fontSize: '9px',
              outline: 'none',
            }}
          />
          <button
            onClick={() => void send(input)}
            disabled={loading || !input.trim()}
            style={{
              ...mono, fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', padding: '5px 10px', whiteSpace: 'nowrap',
              border: '2px solid var(--vp-ink)', background: 'transparent', color: 'var(--vp-ink)',
              cursor: loading || !input.trim() ? 'default' : 'pointer',
              opacity: loading || !input.trim() ? 0.4 : 1,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </CollapsibleWidget>
  );
};

export default AgentChat;
