import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/useToast';

/**
 * Settings card: connect a user's Claude subscription and fund their AI credit
 * balance. The funnel runs analysis on the user's own Claude plan (free to them);
 * when a job exceeds their plan's rate limit it either slows down or upgrades to
 * the API, billed against this prepaid balance.
 *
 * Backends: `connect-claude` (OAuth link), `my_ai_credit_balance` RPC (derived
 * balance), `create-api-access-checkout` (Stripe top-up → stripe-webhook credits).
 */

const TOPUPS = [
  { plan: 'wallet_10', label: '$10' },
  { plan: 'wallet_25', label: '$25' },
  { plan: 'wallet_50', label: '$50' },
];

const ClaudeSubscriptionSettings: React.FC = () => {
  const { showToast } = useToast();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [pendingState, setPendingState] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    try {
      const { data: status } = await supabase.functions.invoke('connect-claude/status');
      setConnected(!!status?.connected);
      setExpiresAt(status?.expires_at ?? null);
    } catch { setConnected(false); }
    try {
      const { data: cents } = await supabase.rpc('my_ai_credit_balance');
      setBalanceCents(Number(cents ?? 0));
    } catch { setBalanceCents(null); }
  };

  const startConnect = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('connect-claude/start');
      if (error || !data?.authorize_url) throw new Error(error?.message || 'could not start');
      setPendingState(data.state);
      window.open(data.authorize_url, '_blank', 'noopener');
      showToast('Approve in the new tab, then paste the code below', 'info');
    } catch (e: any) {
      showToast(`Connect failed: ${e.message}`, 'error');
    } finally { setBusy(false); }
  };

  const completeConnect = async () => {
    if (!pendingState || !code.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('connect-claude/complete', {
        body: { state: pendingState, code: code.trim() },
      });
      if (error || !data?.ok) throw new Error(error?.message || 'exchange failed');
      showToast('Claude subscription connected', 'success');
      setPendingState(null); setCode('');
      await refresh();
    } catch (e: any) {
      showToast(`Link failed: ${e.message}`, 'error');
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await supabase.functions.invoke('connect-claude/disconnect');
      showToast('Disconnected', 'success');
      await refresh();
    } finally { setBusy(false); }
  };

  const topUp = async (plan: string) => {
    setBusy(true);
    try {
      const base = window.location.origin;
      const { data, error } = await supabase.functions.invoke('create-api-access-checkout', {
        body: { subscription_type: plan, success_url: `${base}/settings?topup=success`, cancel_url: `${base}/settings?topup=cancelled` },
      });
      if (error || !data?.checkout_url) throw new Error(error?.message || 'checkout failed');
      window.location.href = data.checkout_url;
    } catch (e: any) {
      showToast(`Top-up failed: ${e.message}`, 'error');
      setBusy(false);
    }
  };

  const dollars = balanceCents == null ? null : (balanceCents / 100).toFixed(2);

  const LABEL: React.CSSProperties = { display: 'block', fontSize: '9px', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase' };
  const BTN_DARK: React.CSSProperties = { fontSize: '11px', padding: '6px 12px', background: '#000', color: '#fff', border: '2px solid #000', borderRadius: 0, cursor: 'pointer', fontFamily: 'Arial, sans-serif' };
  const BTN_GHOST: React.CSSProperties = { fontSize: '11px', padding: '6px 12px', background: '#fff', color: '#000', border: '2px solid #000', borderRadius: 0, cursor: 'pointer', fontFamily: 'Arial, sans-serif' };

  return (
    <div style={{ border: '2px solid #000', borderRadius: 0, padding: '16px', fontFamily: 'Arial, sans-serif', display: 'grid', gap: '14px' }}>
      <div>
        <h3 style={{ ...LABEL, fontSize: '11px', margin: 0 }}>Claude Subscription</h3>
        <p style={{ fontSize: '12px', color: '#444', margin: '6px 0 0', lineHeight: 1.5 }}>
          Run analysis on your own Claude plan. When a job hits your plan's limit it upgrades to
          the API, billed from your credit balance below.
        </p>
      </div>

      {/* Connection status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ fontSize: '12px' }}>
          {connected == null ? 'Checking…'
            : connected
              ? <span style={{ color: '#0a7d28' }}>● Connected{expiresAt ? ` · token renews ${new Date(expiresAt * 1000).toLocaleDateString()}` : ''}</span>
              : <span style={{ color: '#666' }}>● Not connected</span>}
        </div>
        {connected
          ? <button disabled={busy} onClick={disconnect} style={BTN_GHOST}>Disconnect</button>
          : <button disabled={busy} onClick={startConnect} style={BTN_DARK}>Connect Claude</button>}
      </div>

      {/* Code paste step (after start) */}
      {pendingState && !connected && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="Paste the authorization code"
            style={{ flex: 1, fontSize: '13px', border: '2px solid #000', borderRadius: 0, padding: '6px 8px', fontFamily: "'Courier New', monospace" }}
          />
          <button disabled={busy || !code.trim()} onClick={completeConnect} style={{ ...BTN_DARK, opacity: busy || !code.trim() ? 0.4 : 1 }}>Link</button>
        </div>
      )}

      {/* Balance + top-up */}
      <div style={{ borderTop: '2px solid #000', paddingTop: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ ...LABEL, color: '#666' }}>Credit balance</span>
          <span style={{ fontSize: '14px', fontWeight: 'bold', fontFamily: "'Courier New', monospace" }}>{dollars == null ? '—' : `$${dollars}`}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {TOPUPS.map((t) => (
            <button key={t.plan} disabled={busy} onClick={() => topUp(t.plan)} style={{ ...BTN_GHOST, flex: 1 }}>
              Add {t.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '11px', color: '#888', margin: '8px 0 0', lineHeight: 1.4 }}>
          Prepaid — you can never be charged more than your balance. Funds your API overflow only;
          usage on your own Claude plan is free.
        </p>
      </div>
    </div>
  );
};

export default ClaudeSubscriptionSettings;
