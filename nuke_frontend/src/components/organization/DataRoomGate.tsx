/**
 * Data room gate: anon = phone (SMS code) or email (no code) → NDA; signed in = continue → NDA.
 * Never surfaces raw database/API errors; offers email fallback so we don't look like we're blocking or stealing data.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import '../../styles/unified-design-system.css';

const NDA_AND_TERMS = `
CONFIDENTIALITY AND NON-DISCLOSURE AGREEMENT

This Agreement is entered into in connection with your request to access confidential investor and business materials ("Materials") of the organization identified on this page (the "Company").

1. CONFIDENTIAL INFORMATION
You agree that all Materials provided to you are confidential and proprietary. You will not disclose, copy, or use the Materials except for the sole purpose of evaluating a potential business or investment relationship with the Company.

2. NO DISTRIBUTION
You will not distribute, publish, or share the Materials with any third party without the prior written consent of the Company.

3. NOT AN OFFER
The Materials do not constitute an offer or solicitation to sell or purchase securities. No investment decision should be made solely on the basis of these Materials.

4. GOVERNING LAW
This Agreement is governed by the laws of the State of Delaware.

By signing below, you acknowledge that you have read, understood, and agree to be bound by this Agreement and the platform Terms of Service and Privacy Policy.
`;

function toFriendlyError(raw: string | undefined): string {
  if (!raw) return 'Something went wrong. Please try again or use your email instead.';
  const lower = raw.toLowerCase();
  if (lower.includes('database') || lower.includes('saving new user') || lower.includes('duplicate') || lower.includes('constraint') || lower.includes('row-level')) {
    return 'Something went wrong on our side. Please try again or use your email instead to continue.';
  }
  if (lower.includes('invalid') && lower.includes('code')) return 'That code isn’t valid. Please try again or request a new code.';
  if (lower.includes('phone') && (lower.includes('invalid') || lower.includes('not supported'))) {
    return 'We couldn’t send a code to that number. Please try your email instead.';
  }
  if (lower.includes('otp') && (lower.includes('provider') || lower.includes('twilio') || lower.includes('authenticate') || lower.includes('20003'))) {
    return 'We can’t send text codes right now. Please use your email instead to continue.';
  }
  return 'Something went wrong. Please try again or use your email instead.';
}

export interface DataRoomGateProps {
  organizationId: string;
  organizationName: string;
  onAccessGranted: () => void;
  onClose?: () => void;
}

type Step = 'identify' | 'nda';
type IdentifyMethod = 'phone' | 'email' | 'password';

export default function DataRoomGate({ organizationId, organizationName, onAccessGranted, onClose }: DataRoomGateProps) {
  const [user, setUser] = useState<{ id: string; email?: string; phone?: string; fullName?: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [step, setStep] = useState<Step>('identify');
  const [identifyMethod, setIdentifyMethod] = useState<IdentifyMethod>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [emailIdentifier, setEmailIdentifier] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (u) {
        setUser({
          id: u.id,
          email: u.email ?? undefined,
          phone: (u as any).phone ?? undefined,
          fullName: (u.user_metadata?.full_name as string) ?? u.email ?? (u as any).phone ?? undefined,
        });
      } else {
        setUser(null);
      }
      setAuthChecked(true);
    });
  }, []);

  const handleIdentify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (user) {
      setStep('nda');
      return;
    }
    if (identifyMethod === 'email') {
      const trimmed = email.trim();
      if (!trimmed || !trimmed.includes('@')) {
        setError('Please enter a valid email address.');
        return;
      }
      setEmailIdentifier(trimmed);
      setMessage('We’ll use this email to connect your access to an account later if you sign up.');
      setStep('nda');
      return;
    }
    if (identifyMethod === 'password') {
      const code = accessCode.trim().replace(/\D/g, '');
      if (!code) {
        setError('Please enter the access code you were given.');
        return;
      }
      setLoading(true);
      try {
        let identifier = 'unknown';
        try {
          const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
          const j = await res.json();
          if (j?.ip) identifier = String(j.ip);
        } catch {
          // use 'unknown' so RPC still enforces 2-use bucket for failed IP
        }
        const { data, error: rpcError } = await supabase.rpc('validate_data_room_access_code', {
          p_organization_id: organizationId,
          p_code: code,
          p_identifier: identifier,
        });
        if (rpcError) throw new Error(rpcError.message);
        const result = data as { ok: boolean; reason?: string } | null;
        if (!result?.ok) {
          if (result?.reason === 'limit_reached') {
            setError('This code has reached its use limit. Use phone or email instead.');
          } else {
            setError('That code isn’t valid. Please check it and try again.');
          }
          return;
        }
        setEmailIdentifier(null);
        setMessage('Access granted.');
        setStep('nda');
      } catch (err: any) {
        setError(err?.message?.includes('limit_reached') ? 'This code has reached its use limit. Use phone or email instead.' : 'Something went wrong. Please try again.');
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!phone.trim()) {
      setError('Please enter your phone number');
      return;
    }
    setLoading(true);
    try {
      const normalized = phone.replace(/\D/g, '');
      const toSend = normalized.length === 10 ? `+1${normalized}` : phone.startsWith('+') ? phone : `+${normalized}`;
      const { error: err } = await supabase.auth.signInWithOtp({ phone: toSend });
      if (err) throw err;
      setShowOtpInput(true);
      setMessage('We sent a code to your phone. Enter it below.');
    } catch (err: any) {
      setError(toFriendlyError(err?.message));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!otpCode.trim()) {
      setError('Please enter the code');
      return;
    }
    setLoading(true);
    try {
      const normalized = phone.replace(/\D/g, '');
      const toVerify = normalized.length === 10 ? `+1${normalized}` : phone.startsWith('+') ? phone : `+${normalized}`;
      const { data: { user: u }, error: err } = await supabase.auth.verifyOtp({
        phone: toVerify,
        token: otpCode.trim(),
        type: 'sms',
      });
      if (err) throw err;
      if (u) {
        setUser({
          id: u.id,
          phone: (u as any).phone ?? toVerify,
          fullName: (u.user_metadata?.full_name as string) ?? toVerify,
        });
        setStep('nda');
        setMessage(null);
      }
    } catch (err: any) {
      setError(toFriendlyError(err?.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSignNda = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError('Please agree to the NDA and terms.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const identifier = user?.phone ?? user?.email ?? emailIdentifier ?? user?.id ?? null;
      await supabase.from('system_logs').insert({
        log_type: 'investor_portal',
        message: 'data_room_access',
        details: {
          organization_id: organizationId,
          user_id: user?.id ?? null,
          identifier: identifier ?? (emailIdentifier ? `email:${emailIdentifier}` : null),
          timestamp: new Date().toISOString(),
        },
      }).then(() => {}, () => {});
    } catch {
      // ignore
    }
    try {
      sessionStorage.setItem(`data_room_access_${organizationId}`, 'true');
    } catch {
      // ignore
    }
    setLoading(false);
    onAccessGranted();
  };

  const showPhoneForm = !user && identifyMethod === 'phone';
  const showEmailForm = !user && identifyMethod === 'email';
  const showPasswordForm = !user && identifyMethod === 'password';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        role="dialog"
        style={{
          background: 'var(--surface, #fff)', maxWidth: 440,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto', }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 24 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Investor materials — {organizationName}</h2>

          {step === 'identify' && (
            <>
              {!authChecked ? (
                <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>Checking sign-in…</p>
              ) : (
                <>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
                {user ? 'Continue to NDA.' : 'Enter your phone or email to continue. We’ll use it only to connect your access to an account if you sign up.'}
              </p>
              {!user && (
                <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--grey-200)' }}>
                  <button
                    type="button"
                    onClick={() => { setIdentifyMethod('phone'); setError(null); setMessage(null); setShowOtpInput(false); setOtpCode(''); }}
                    style={{ padding: '8px 12px', fontSize: 13, background: identifyMethod === 'phone' ? 'var(--grey-200)' : 'transparent', border: 'none', cursor: 'pointer', borderBottom: identifyMethod === 'phone' ? '2px solid var(--accent, #3b82f6)' : '2px solid transparent', marginBottom: -1 }}
                  >
                    Phone
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIdentifyMethod('email'); setError(null); setMessage(null); setShowOtpInput(false); }}
                    style={{ padding: '8px 12px', fontSize: 13, background: identifyMethod === 'email' ? 'var(--grey-200)' : 'transparent', border: 'none', cursor: 'pointer', borderBottom: identifyMethod === 'email' ? '2px solid var(--accent, #3b82f6)' : '2px solid transparent', marginBottom: -1 }}
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIdentifyMethod('password'); setError(null); setMessage(null); setShowOtpInput(false); }}
                    style={{ padding: '8px 12px', fontSize: 13, background: identifyMethod === 'password' ? 'var(--grey-200)' : 'transparent', border: 'none', cursor: 'pointer', borderBottom: identifyMethod === 'password' ? '2px solid var(--accent, #3b82f6)' : '2px solid transparent', marginBottom: -1 }}
                  >
                    Password
                  </button>
                </div>
              )}
              <form onSubmit={user ? (e) => { e.preventDefault(); setStep('nda'); } : showOtpInput ? handleVerifyOtp : handleIdentify}>
                {user ? (
                  <p style={{ marginBottom: 16, fontSize: 13 }}>Signed in as <strong>{user.fullName || user.email || user.phone || 'you'}</strong></p>
                ) : (
                  <>
                    {showPhoneForm && (
                      <>
                        <div style={{ marginBottom: 16 }}>
                          <input
                            type="tel"
                            className="input"
                            placeholder="Phone (e.g. 7025551234)"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            required={!showOtpInput}
                            style={{ width: '100%' }}
                          />
                        </div>
                        {showOtpInput && (
                          <div style={{ marginBottom: 16 }}>
                            <input
                              type="text"
                              className="input"
                              placeholder="Enter code"
                              value={otpCode}
                              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              maxLength={6}
                              required
                              style={{ width: '100%' }}
                            />
                            <button
                              type="button"
                              onClick={() => { setShowOtpInput(false); setOtpCode(''); setMessage(null); setError(null); }}
                              style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', textDecoration: 'underline' }}
                            >
                              ← Back to phone number
                            </button>
                            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>Code not working? Use your <button type="button" onClick={() => { setIdentifyMethod('email'); setShowOtpInput(false); setError(null); setMessage(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}>email instead</button>.</p>
                          </div>
                        )}
                      </>
                    )}
                    {showEmailForm && (
                      <div style={{ marginBottom: 16 }}>
                        <input
                          type="email"
                          className="input"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          style={{ width: '100%' }}
                        />
                        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>We'll only use this to link your access to an account if you sign up later. No code required.</p>
                      </div>
                    )}
                    {showPasswordForm && (
                      <div style={{ marginBottom: 16 }}>
                        <input
                          type="text"
                          className="input"
                          placeholder="Access code"
                          value={accessCode}
                          onChange={(e) => setAccessCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          maxLength={4}
                          required
                          style={{ width: '100%' }}
                          autoComplete="one-time-code"
                        />
                        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>Enter the code you were given. Instant access — no email or phone needed.</p>
                      </div>
                    )}
                  </>
                )}
                {message && <p style={{ color: 'var(--success)', marginBottom: 12, fontSize: 12 }}>{message}</p>}
                {error && <p style={{ color: 'var(--error)', marginBottom: 12, fontSize: 12 }}>{error}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="button button-primary" disabled={loading || (showEmailForm && !email.trim().includes('@')) || (showPasswordForm && !accessCode.trim())} style={{ padding: '10px 18px' }}>
                    {loading ? '…' : user ? 'Continue' : showOtpInput ? 'Verify' : identifyMethod === 'email' ? 'Continue with email' : identifyMethod === 'password' ? 'Continue with code' : 'Send code'}
                  </button>
                  {onClose && <button type="button" onClick={onClose} className="button" style={{ padding: '10px 18px' }}>Cancel</button>}
                </div>
              </form>
                </>
              )}
            </>
          )}

          {step === 'nda' && (
            <>
              {(user || emailIdentifier !== undefined) && (
                <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
                  Access for {user ? (user.fullName || user.email || user.phone || 'you') : emailIdentifier ?? 'Visitor'}
                </p>
              )}
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>Please read and agree to access the data room.</p>
              <div style={{ maxHeight: 200, overflowY: 'auto', padding: 12, background: 'var(--grey-100)', marginBottom: 16, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {NDA_AND_TERMS}
              </div>
              <p style={{ marginBottom: 12, fontSize: 11 }}>
                <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> · <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
              </p>
              <form onSubmit={handleSignNda}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>I have read and agree to the NDA and terms above.</span>
                </label>
                {error && <p style={{ color: 'var(--error)', marginBottom: 12, fontSize: 12 }}>{error}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="button button-primary" disabled={loading || !agreed} style={{ padding: '10px 18px' }}>
                    {loading ? '…' : 'I agree and sign — enter data room'}
                  </button>
                  <button type="button" onClick={() => setStep('identify')} className="button" style={{ padding: '10px 18px' }}>Back</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
