/**
 * Analysis Settings Page
 *
 * Lets a user choose HOW their vehicles get analyzed — in the app, instead of
 * editing GitHub secrets/YAML. Three compute models:
 *
 *   nuke_hosted      — the platform pays; nothing to configure.
 *   byo_api_key      — the user's own Anthropic/OpenAI/Google API key (per-token billing).
 *   byo_subscription — the user's own Claude subscription token (claude setup-token),
 *                      which bills the subscription rather than the API.
 *
 * SECURITY: the credential is written straight to Supabase Vault via the
 * set_analysis_credential RPC and is NEVER read back to the client. This page
 * only ever sees a masked hint (e.g. '****abcd'). The runner (cloud drain)
 * decrypts it server-side via the service-role-only get_analysis_credential RPC.
 *
 * Route: /settings/analysis
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getSupabaseFunctionsUrl } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

type Method = 'nuke_hosted' | 'byo_api_key' | 'byo_subscription';
type Provider = 'anthropic' | 'openai' | 'google';

interface AnalysisSettings {
  user_id: string;
  method: Method;
  provider: Provider | null;
  model: string | null;
  tier: string;
  enabled: boolean;
  credential_hint: string | null;
  updated_at: string;
}

// One row per vehicle from get_user_ingestion_status — the "see the ingestion" board.
interface IngestionRow {
  vehicle_id: string;
  vehicle: string;
  total_images: number;
  analyzed: number;
  pending: number;
  dated: number;
  hashed: number;
  sessioned: number;
  duplicates: number;
  confirmed: number;
  unrelated: number;
  analysis_cost_usd: number;
  last_analyzed: string | null;
}

const METHODS: { value: Method; label: string; blurb: string; needsCredential: boolean }[] = [
  {
    value: 'nuke_hosted',
    label: 'NUKE Hosted',
    blurb: 'The platform analyzes your vehicles. Nothing to configure — just turn it on.',
    needsCredential: false,
  },
  {
    value: 'byo_subscription',
    label: 'My Claude Subscription',
    blurb:
      'Use your own Claude (Max/Pro) subscription. Run `claude setup-token` on a machine logged into your subscription and paste the token below. Bills your subscription, not per-token API.',
    needsCredential: true,
  },
  {
    value: 'byo_api_key',
    label: 'My API Key',
    blurb:
      'Use your own Anthropic, OpenAI, or Google API key. Pay-per-token, billed directly to your provider account.',
    needsCredential: true,
  },
];

// Sensible model defaults per provider; the user can override.
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  google: ['gemini-2.0-flash', 'gemini-1.5-pro'],
  subscription: ['claude-sonnet-4-6', 'claude-opus-4-8'],
};

export default function AnalysisSettingsPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<AnalysisSettings | null>(null);
  const [ingestion, setIngestion] = useState<IngestionRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // form state
  const [method, setMethod] = useState<Method>('nuke_hosted');
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [model, setModel] = useState('');
  const [secret, setSecret] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      navigate('/login');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, authLoading]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: e } = await supabase
        .from('user_analysis_settings')
        .select('user_id, method, provider, model, tier, enabled, credential_hint, updated_at')
        .maybeSingle();
      if (e) throw e;
      if (data) {
        const s = data as AnalysisSettings;
        setSettings(s);
        setMethod(s.method);
        if (s.provider) setProvider(s.provider);
        if (s.model) setModel(s.model);
      }
      // Ingestion board — per-vehicle progress against the extraction contract.
      const uid = session?.user?.id;
      if (uid) {
        const { data: ing } = await supabase.rpc('get_user_ingestion_status', { p_user_id: uid });
        if (Array.isArray(ing)) setIngestion(ing as IngestionRow[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const activeMethodMeta = METHODS.find((m) => m.value === method)!;

  // Model suggestions for the current selection.
  const suggestKey = method === 'byo_subscription' ? 'subscription' : provider;
  const suggestions = MODEL_SUGGESTIONS[suggestKey] ?? [];

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (activeMethodMeta.needsCredential) {
        // A new secret was typed → store it (also flips method/provider/model).
        if (secret.trim()) {
          const p: Provider = method === 'byo_subscription' ? 'anthropic' : provider;
          const { error: e } = await supabase.rpc('set_analysis_credential', {
            p_method: method,
            p_provider: p,
            p_secret: secret.trim(),
            p_model: model.trim() || null,
          });
          if (e) throw e;
          setNotice('Saved. Your credential is stored encrypted in Vault — it is never shown again.');
          setSecret('');
        } else if (settings?.credential_hint && settings.method === method) {
          // No new secret, but a credential already exists → just update model/method.
          const { error: e } = await supabase.rpc('set_analysis_method', {
            p_method: method,
            p_model: model.trim() || null,
            p_tier: null,
            p_enabled: null,
          });
          if (e) throw e;
          setNotice('Settings updated.');
        } else {
          setError('Paste your ' + (method === 'byo_subscription' ? 'subscription token' : 'API key') + ' to enable this method.');
          setSaving(false);
          return;
        }
      } else {
        // nuke_hosted — no credential.
        const { error: e } = await supabase.rpc('set_analysis_method', {
          p_method: method,
          p_model: model.trim() || null,
          p_tier: null,
          p_enabled: null,
        });
        if (e) throw e;
        setNotice('Switched to NUKE Hosted analysis.');
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Fire a one-off cloud run for just this user's vehicles, right now.
  const runNow = async () => {
    setRunning(true);
    setError('');
    setNotice('');
    try {
      const accessToken = session?.access_token;
      if (!accessToken) {
        navigate('/login');
        return;
      }
      const res = await fetch(`${getSupabaseFunctionsUrl()}/trigger-analysis-run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: 10, batch: 8 }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        setNotice(result.message || 'Analysis run dispatched — it runs in the cloud.');
      } else {
        setError(result.error || `Could not start analysis (${res.status}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start analysis');
    } finally {
      setRunning(false);
    }
  };

  const labelStyle = {
    display: 'block',
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  };
  const inputStyle = {
    width: '100%',
    padding: '10px',
    fontSize: '12px',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', maxWidth: '720px', margin: '0 auto' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '720px', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ fontSize: '18px', marginBottom: '4px' }}>Analysis Compute</h1>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>
        Choose how your vehicles get analyzed. Your photos are read by an AI detective that writes
        observations onto each vehicle's timeline. Pick who provides — and pays for — that compute.
      </p>

      {/* Current state */}
      {settings && (
        <div
          style={{
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            padding: '12px',
            marginBottom: '20px',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Current method</span>
            <span style={{ fontWeight: 700 }}>
              {METHODS.find((m) => m.value === settings.method)?.label ?? settings.method}
            </span>
          </div>
          {settings.credential_hint && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Stored credential</span>
              <code style={{ fontFamily: "'Courier New', monospace" }}>{settings.credential_hint}</code>
            </div>
          )}
          {settings.model && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Model</span>
              <code style={{ fontFamily: "'Courier New', monospace" }}>{settings.model}</code>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(244, 67, 54, 0.1)',
            border: '1px solid var(--error, #f44336)',
            padding: '12px',
            marginBottom: '16px',
            color: 'var(--error, #f44336)',
            fontSize: '12px',
          }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          style={{
            background: 'rgba(76, 175, 80, 0.1)',
            border: '1px solid var(--success, #4caf50)',
            padding: '12px',
            marginBottom: '16px',
            color: 'var(--success, #4caf50)',
            fontSize: '12px',
          }}
        >
          {notice}
        </div>
      )}

      {/* Method picker */}
      <div style={{ marginBottom: '20px' }}>
        <label style={labelStyle}>Method</label>
        {METHODS.map((m) => (
          <label
            key={m.value}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              padding: '12px',
              border: '1px solid var(--border)',
              marginBottom: '6px',
              cursor: 'pointer',
              background: method === m.value ? 'var(--bg-secondary)' : 'transparent',
            }}
          >
            <input
              type="radio"
              name="analysis-method"
              checked={method === m.value}
              onChange={() => setMethod(m.value)}
              style={{ marginTop: '2px' }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 700 }}>{m.label}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{m.blurb}</div>
            </div>
          </label>
        ))}
      </div>

      {/* Provider (api-key only) */}
      {method === 'byo_api_key' && (
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} style={inputStyle}>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
            <option value="google">Google (Gemini)</option>
          </select>
        </div>
      )}

      {/* Credential (byo methods) */}
      {activeMethodMeta.needsCredential && (
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>
            {method === 'byo_subscription' ? 'Subscription token' : 'API key'}
          </label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={
              settings?.credential_hint && settings.method === method
                ? `Stored (${settings.credential_hint}) — paste a new one to replace`
                : method === 'byo_subscription'
                ? 'Paste the output of `claude setup-token`'
                : 'sk-ant-... / sk-... / AIza...'
            }
            autoComplete="off"
            style={{ ...inputStyle, fontFamily: "'Courier New', monospace" }}
          />
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Stored encrypted in Vault. Never displayed again, never sent to your browser after saving.
          </div>
        </div>
      )}

      {/* Model */}
      {method !== 'nuke_hosted' && (
        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>Model</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list="analysis-model-suggestions"
            placeholder={suggestions[0] ?? 'default'}
            style={{ ...inputStyle, fontFamily: "'Courier New', monospace" }}
          />
          <datalist id="analysis-model-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Leave blank for the default ({suggestions[0] ?? 'provider default'}).
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            background: 'var(--accent)',
            color: 'var(--bg)',
            border: 'none',
            padding: '12px 20px',
            fontSize: '12px',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.5 : 1,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 700,
          }}
        >
          {saving ? 'Saving…' : 'Save Analysis Settings'}
        </button>

        {/* On-demand run — no GitHub tab needed. Disabled until a method is saved. */}
        <button
          onClick={runNow}
          disabled={running || !settings || settings.enabled === false}
          title={
            !settings
              ? 'Save your analysis settings first'
              : settings.enabled === false
              ? 'Analysis is turned off'
              : 'Analyze your vehicles now (runs in the cloud)'
          }
          style={{
            background: 'transparent',
            color: 'var(--text)',
            border: '2px solid var(--accent)',
            padding: '12px 20px',
            fontSize: '12px',
            cursor: running || !settings || settings.enabled === false ? 'default' : 'pointer',
            opacity: running || !settings || settings.enabled === false ? 0.5 : 1,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 700,
          }}
        >
          {running ? 'Starting…' : 'Analyze Now'}
        </button>
      </div>
      <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px' }}>
        "Analyze Now" runs a short cloud burst over your vehicles. The hourly schedule keeps going on its own.
      </p>

      {/* INGESTION BOARD — see each vehicle fill against the extraction contract. */}
      {ingestion.length > 0 && (() => {
        const sum = (k: keyof IngestionRow) =>
          ingestion.reduce((a, r) => a + (Number(r[k]) || 0), 0);
        const total = sum('total_images');
        const analyzed = sum('analyzed');
        const cost = ingestion.reduce((a, r) => a + (Number(r.analysis_cost_usd) || 0), 0);
        const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
        const chipStyle = {
          fontFamily: "'Courier New', monospace",
          fontSize: '10px',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap' as const,
        };
        return (
          <div style={{ marginTop: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
              <label style={labelStyle}>Ingestion · {ingestion.length} vehicles</label>
              <span style={chipStyle}>
                {analyzed.toLocaleString()}/{total.toLocaleString()} analyzed ({pct(analyzed, total)}%)
                {cost > 0 ? ` · $${cost.toFixed(2)}` : ' · subscription'}
              </span>
            </div>
            <div style={{ border: '1px solid var(--border)' }}>
              {ingestion.map((r, i) => {
                const ap = pct(r.analyzed, r.total_images);
                return (
                  <div
                    key={r.vehicle_id}
                    style={{
                      padding: '8px 10px',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                      background: i % 2 ? 'var(--bg-secondary)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700 }}>{r.vehicle || 'Unknown'}</span>
                      <span style={chipStyle}>
                        {r.analyzed}/{r.total_images} · {ap}%
                      </span>
                    </div>
                    {/* analyzed progress bar (2px, no radius) */}
                    <div style={{ height: '4px', background: 'var(--border)', marginTop: '5px' }}>
                      <div style={{ height: '4px', width: `${ap}%`, background: 'var(--accent)' }} />
                    </div>
                    {/* contract fill chips */}
                    <div style={{ display: 'flex', gap: '12px', marginTop: '5px', flexWrap: 'wrap' }}>
                      <span style={chipStyle}>dated {r.dated}</span>
                      <span style={chipStyle}>hashed {r.hashed}</span>
                      <span style={chipStyle}>sessions {r.sessioned}</span>
                      {r.duplicates > 0 && <span style={chipStyle}>dupes {r.duplicates}</span>}
                      {r.confirmed > 0 && <span style={chipStyle}>confirmed {r.confirmed}</span>}
                      {r.unrelated > 0 && <span style={chipStyle}>off-subject {r.unrelated}</span>}
                      {r.pending > 0 && <span style={{ ...chipStyle, color: 'var(--accent)' }}>pending {r.pending}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
