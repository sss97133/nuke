/**
 * Developer Signup Page
 *
 * Streamlined signup for API developers.
 * Creates account → generates first API key → shows key once → links to docs.
 *
 * Route: /developers/signup
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type Step = 'signup' | 'creating-key' | 'done';

export default function DeveloperSignup() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Email and password required');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Try signup
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        // If user already exists, try signing in
        if (signUpError.message.includes('already registered') || signUpError.message.includes('duplicate')) {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) throw signInError;
        } else {
          throw signUpError;
        }
      }

      // Sign in if needed (some Supabase configs require email confirmation)
      if (signUpData?.user && !signUpData.session) {
        // Try immediate sign in
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError('Account created. Check your email to confirm, then come back to sign in.');
          setLoading(false);
          return;
        }
      }

      // Now generate the first API key
      setStep('creating-key');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Please sign in to generate your API key.');
        setStep('signup');
        setLoading(false);
        return;
      }

      const keyResponse = await supabase.functions.invoke('api-keys-manage', {
        method: 'POST',
        body: { name: 'My First Key' },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (keyResponse.error || !keyResponse.data?.key) {
        setError('Account created but failed to generate API key. Go to Settings > API Keys.');
        setStep('signup');
        setLoading(false);
        return;
      }

      setApiKey(keyResponse.data.key);
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGitHubSignup = async () => {
    setLoading(true);
    setError(null);
    try {
      sessionStorage.setItem('login_return_url', '/developers/dashboard');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: `${window.location.origin}/developers/dashboard?generate_key=1`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'GitHub signup failed');
      setLoading(false);
    }
  };

  const copyKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: '0 16px', fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)' }}>
      {step === 'signup' && (
        <>
          <h1 style={{ fontSize: 'var(--fs-13, 13px)', fontWeight: 700, marginBottom: 4 }}>Developer Signup</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
            Create an account to get your API key. Access 810K+ vehicle profiles, valuations, auction data, and more.
          </p>

          {error && (
            <div style={{ background: 'var(--error-bg, #fef2f2)', border: '1px solid var(--error, #ef4444)', color: 'var(--error, #ef4444)', padding: '8px 12px', marginBottom: 16 }}>
              {error}
            </div>
          )}

          <button
            onClick={handleGitHubSignup}
            disabled={loading}
            style={{
              width: '100%', padding: '10px', marginBottom: 12,
              background: 'var(--surface, #1a1a1a)', color: 'var(--text, #fff)',
              border: '2px solid var(--border)', cursor: 'pointer',
              fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)', fontWeight: 600,
            }}
          >
            {loading ? 'Connecting...' : 'Sign up with GitHub'}
          </button>

          <div style={{ textAlign: 'center', color: 'var(--text-disabled)', margin: '12px 0' }}>or</div>

          <form onSubmit={handleSignup}>
            <input
              type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', marginBottom: 10, border: '2px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)', boxSizing: 'border-box' }}
            />
            <input
              type="password" placeholder="Password (min 6 chars)" value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', marginBottom: 16, border: '2px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)', boxSizing: 'border-box' }}
            />
            <button
              type="submit" disabled={loading}
              style={{
                width: '100%', padding: '10px',
                background: 'var(--accent)', color: 'var(--text-on-accent, #fff)', border: 'none', cursor: 'pointer',
                fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}
            >
              {loading ? 'Creating account...' : 'Create Account & Get API Key'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 16, color: 'var(--text-secondary)' }}>
            Already have an account? <Link to="/login?redirect=/developers/dashboard" style={{ color: 'var(--accent)' }}>Sign in</Link>
          </p>
        </>
      )}

      {step === 'creating-key' && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ color: 'var(--text-secondary)' }}>Generating your API key...</div>
        </div>
      )}

      {step === 'done' && apiKey && (
        <>
          <h1 style={{ fontSize: 'var(--fs-13, 13px)', fontWeight: 700, marginBottom: 8 }}>Your API Key</h1>
          <p style={{ color: 'var(--error, #ef4444)', fontWeight: 600, marginBottom: 16 }}>
            Save this key now. You will not be able to see it again.
          </p>

          <div style={{ background: 'var(--surface)', border: '2px solid var(--border)', padding: 12, fontFamily: "'Courier New', monospace", fontSize: 'var(--fs-8, 8px)', wordBreak: 'break-all', marginBottom: 8 }}>
            {apiKey}
          </div>

          <button
            onClick={copyKey}
            style={{
              width: '100%', padding: '8px', marginBottom: 24,
              background: copied ? 'var(--success, #22c55e)' : 'var(--accent)', color: 'var(--text-on-accent, #fff)',
              border: 'none', cursor: 'pointer',
              fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)', fontWeight: 600,
            }}
          >
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>

          <h2 style={{ fontSize: 'var(--fs-10, 10px)', fontWeight: 700, marginBottom: 12 }}>Quick Start</h2>
          <div style={{ background: 'var(--surface)', border: '2px solid var(--border)', padding: 12, fontFamily: "'Courier New', monospace", fontSize: 'var(--fs-8, 8px)', whiteSpace: 'pre', overflow: 'auto', marginBottom: 24, lineHeight: 1.6 }}>
{`npm install @nuke1/sdk

import Nuke from '@nuke1/sdk';
const nuke = new Nuke('${apiKey.slice(0, 12)}...');

const comps = await nuke.comps.get({
  make: 'Porsche', model: '911'
});`}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => navigate('/developers/dashboard')}
              style={{ flex: 1, padding: '10px', background: 'var(--accent)', color: 'var(--text-on-accent, #fff)', border: 'none', cursor: 'pointer', fontWeight: 600, fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)' }}
            >
              Go to Dashboard
            </button>
            <Link to="/api" style={{ flex: 1, padding: '10px', background: 'var(--surface)', color: 'var(--text)', border: '2px solid var(--border)', textDecoration: 'none', textAlign: 'center', fontWeight: 600, fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)' }}>
              View Docs
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
