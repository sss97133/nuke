/**
 * Data room gate: anon = phone → SMS code → NDA; signed in = continue → NDA.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

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

export interface DataRoomGateProps {
  organizationId: string;
  organizationName: string;
  onAccessGranted: () => void;
  onClose?: () => void;
}

type Step = 'identify' | 'nda';

export default function DataRoomGate({ organizationId, organizationName, onAccessGranted, onClose }: DataRoomGateProps) {
  const [user, setUser] = useState<{ id: string; email?: string; phone?: string; fullName?: string } | null>(null);
  const [step, setStep] = useState<Step>('identify');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    });
  }, []);

  const handleIdentify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (user) {
      setStep('nda');
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
      setError(err.message || 'Failed to send code');
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
      setError(err.message || 'Invalid code');
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
      await supabase.from('system_logs').insert({
        log_type: 'investor_portal',
        message: 'data_room_access',
        details: {
          organization_id: organizationId,
          user_id: user?.id ?? null,
          identifier: user?.phone ?? user?.id ?? null,
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
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
          background: 'var(--surface, #fff)',
          borderRadius: 12,
          maxWidth: 440,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 24 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Investor materials — {organizationName}</h2>

          {step === 'identify' && (
            <>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>
                {user ? 'Continue to NDA.' : 'Enter your phone number and we’ll text you a code.'}
              </p>
              <form onSubmit={user ? (e) => { e.preventDefault(); setStep('nda'); } : showOtpInput ? handleVerifyOtp : handleIdentify}>
                {user ? (
                  <p style={{ marginBottom: 16, fontSize: 13 }}>Signed in as <strong>{user.fullName || user.email || user.phone || 'you'}</strong></p>
                ) : (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <input
                        type="tel"
                        className="input"
                        placeholder="Phone (e.g. +1234567890)"
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
                      </div>
                    )}
                  </>
                )}
                {message && <p style={{ color: 'var(--success)', marginBottom: 12, fontSize: 12 }}>{message}</p>}
                {error && <p style={{ color: 'var(--error)', marginBottom: 12, fontSize: 12 }}>{error}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="button button-primary" disabled={loading} style={{ padding: '10px 18px' }}>
                    {loading ? '…' : user ? 'Continue' : showOtpInput ? 'Verify' : 'Send code'}
                  </button>
                  {onClose && <button type="button" onClick={onClose} className="button" style={{ padding: '10px 18px' }}>Cancel</button>}
                </div>
              </form>
            </>
          )}

          {step === 'nda' && (
            <>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>Please read and agree to access the data room.</p>
              <div style={{ maxHeight: 200, overflowY: 'auto', padding: 12, background: 'var(--grey-100)', borderRadius: 8, marginBottom: 16, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
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
