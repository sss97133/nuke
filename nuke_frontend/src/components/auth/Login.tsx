import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ForgotPasswordForm from '../auth/ForgotPasswordForm';
import '../../design-system.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<'signin' | 'signup'>(() => {
    const modeParam = searchParams.get('mode');
    if (modeParam === 'signup' || location.pathname === '/signup') return 'signup';
    return 'signin';
  });
  const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const navigate = useNavigate();

  // Support both returnUrl and redirect (used across the app)
  // Default: new users land on homepage (Garage tab), not /vehicles which is an extra redirect
  const getReturnUrl = () => searchParams.get('returnUrl') || searchParams.get('redirect') || '/';

  useEffect(() => {
    const modeParam = searchParams.get('mode');
    if (modeParam === 'signup' || location.pathname === '/signup') {
      setMode('signup');
      return;
    }
    if (modeParam === 'signin') {
      setMode('signin');
    }
  }, [location.pathname, searchParams]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();

    if (authMethod === 'email') {
      if (!email || !password) {
        setError('Please enter both email and password');
        return;
      }
    } else {
      if (!phone) {
        setError('Please enter your phone number');
        return;
      }
    }
    
    try {
      setError(null);
      setLoading(true);

      if (authMethod === 'email') {
        if (mode === 'signin') {
          // Try to sign in first
          const { error: signInError, data: { user } = { user: null } } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (signInError && signInError.message.includes('Invalid login credentials')) {
            // If login fails, try to create the account
            const { error: signUpError } = await supabase.auth.signUp({
              email,
              password,
            });

            if (signUpError) {
              const msg = signUpError.message || '';
              if (msg.includes('Database error') || msg.includes('duplicate') || msg.includes('unique')) {
                setError('Account creation failed (database). Please try again or use a different email.');
                return;
              }
              throw signUpError;
            }

            // Try to sign in again after creating account
            const { error: retryError, data: { user: retryUser } = { user: null } } = await supabase.auth.signInWithPassword({
              email,
              password,
            });

            if (retryError) throw retryError;
            if (retryUser) {
              // Account created and login successful
              navigate(getReturnUrl());
            }
          } else if (signInError) {
            throw signInError;
          } else if (user) {
            // Login successful
            navigate(getReturnUrl());
          }
        } else {
          // Sign up with email and password
          const { data: signUpData, error } = await supabase.auth.signUp({
            email,
            password,
          });

          if (error) {
            const msg = error.message || '';
            if (msg.includes('Database error') || msg.includes('duplicate') || msg.includes('unique')) {
              setError('Account creation failed (database). Please try again or use a different email. If it persists, contact support.');
            } else {
              throw error;
            }
            return;
          }

          setMessage(
            signUpData?.user && !signUpData.user.email_confirmed_at
              ? 'Check your email for the confirmation link. You can sign in after confirming.'
              : 'Account created. You can sign in now.'
          );
          setMode('signin');
        }
      } else {
        // Phone authentication
        if (!showOtpInput) {
          // Step 1: Send OTP
          const { error } = await supabase.auth.signInWithOtp({
            phone,
          });

          if (error) throw error;

          setShowOtpInput(true);
          setMessage('OTP sent to your phone. Enter the code below.');
        } else {
          // Step 2: Verify OTP
          if (!otpCode) {
            setError('Please enter the OTP code');
            return;
          }

          const { error, data: { user } } = await supabase.auth.verifyOtp({
            phone,
            token: otpCode,
            type: 'sms',
          });

          if (error) throw error;

          if (user) {
            // Phone auth successful
            navigate(getReturnUrl());
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };
  
  const handleGitHubLogin = async () => {
    try {
      setError(null);
      setLoading(true);
      try {
        sessionStorage.setItem('login_return_url', getReturnUrl());
      } catch {
        // ignore
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {},
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Failed to login with GitHub');
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setError(null);
      setLoading(true);
      try {
        sessionStorage.setItem('login_return_url', getReturnUrl());
      } catch {
        // ignore
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {},
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Failed to login with Google');
      setLoading(false);
    }
  };


  if (showForgotPassword) {
    return (
      <div className="layout">
        <div className="container">
          <div className="main">
            <ForgotPasswordForm onCancel={() => setShowForgotPassword(false)} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <div className="container">
        <div className="main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <div style={{ width: '320px' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 className="heading-1" style={{ marginBottom: '8px' }}>Nuke</h1>
              <p className="text text-muted">Vehicle Provenance Engine</p>
            </div>

            {/* Sign in / Sign up toggle */}
            <div style={{
              display: 'flex',
              marginBottom: '24px',
              border: '2px solid var(--border-light)',
              borderRadius: '0px',
            }}>
              <button
                type="button"
                onClick={() => { setMode('signin'); setError(null); setMessage(null); }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: 'none',
                  fontSize: '8pt',
                  fontWeight: mode === 'signin' ? 700 : 400,
                  backgroundColor: mode === 'signin' ? 'var(--text)' : 'transparent',
                  color: mode === 'signin' ? 'var(--white)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease',
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => { setMode('signup'); setError(null); setMessage(null); }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: 'none',
                  fontSize: '8pt',
                  fontWeight: mode === 'signup' ? 700 : 400,
                  backgroundColor: mode === 'signup' ? 'var(--text)' : 'transparent',
                  color: mode === 'signup' ? 'var(--white)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease',
                }}
              >
                Create account
              </button>
            </div>

            {error && (
              <div className="alert alert-error" role="alert" style={{ marginBottom: '16px' }}>
                {error}
              </div>
            )}

            {message && (
              <div className="alert alert-success" role="status" style={{ marginBottom: '16px' }}>
                {message}
              </div>
            )}

            {/* OAuth buttons */}
            <button
              onClick={handleGoogleLogin}
              className="button button-secondary w-full"
              disabled={loading}
              style={{ marginBottom: '8px' }}
            >
              {loading ? 'Connecting...' : 'Continue with Google'}
            </button>

            <button
              onClick={handleGitHubLogin}
              className="button button-secondary w-full"
              disabled={loading}
              style={{ marginBottom: '16px' }}
            >
              {loading ? 'Connecting...' : 'Continue with GitHub'}
            </button>

            <div style={{ textAlign: 'center', margin: '16px 0', fontSize: '8pt', color: 'var(--text-muted)' }}>
              or
            </div>

            {/* Auth method selector (email / phone) */}
            <div style={{
              display: 'flex',
              marginBottom: '16px',
              border: '2px solid var(--border-light)',
              borderRadius: '0px',
            }}>
              <button
                type="button"
                onClick={() => {
                  setAuthMethod('email');
                  setShowOtpInput(false);
                  setError(null);
                  setMessage(null);
                }}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  border: 'none',
                  fontSize: '8pt',
                  fontWeight: authMethod === 'email' ? 600 : 400,
                  backgroundColor: authMethod === 'email' ? 'var(--grey-100)' : 'transparent',
                  color: authMethod === 'email' ? 'var(--text)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease',
                }}
              >
                Email
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMethod('phone');
                  setShowOtpInput(false);
                  setError(null);
                  setMessage(null);
                }}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  border: 'none',
                  fontSize: '8pt',
                  fontWeight: authMethod === 'phone' ? 600 : 400,
                  backgroundColor: authMethod === 'phone' ? 'var(--grey-100)' : 'transparent',
                  color: authMethod === 'phone' ? 'var(--text)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease',
                }}
              >
                Phone
              </button>
            </div>

            <form onSubmit={handleAuth} style={{ marginBottom: '16px' }}>
              {authMethod === 'email' ? (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <label htmlFor="login-email" className="sr-only">Email</label>
                    <input
                      id="login-email"
                      type="email"
                      className="input"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label htmlFor="login-password" className="sr-only">Password</label>
                    <input
                      id="login-password"
                      type="password"
                      className="input"
                      placeholder={mode === 'signup' ? 'Choose a password' : 'Password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <label htmlFor="login-phone" className="sr-only">Phone number</label>
                    <input
                      id="login-phone"
                      type="tel"
                      className="input"
                      placeholder="Phone number (e.g., +1234567890)"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      autoComplete="tel"
                    />
                  </div>

                  {showOtpInput && (
                    <div style={{ marginBottom: '12px' }}>
                      <label htmlFor="login-otp" className="sr-only">OTP code</label>
                      <input
                        id="login-otp"
                        type="text"
                        className="input"
                        placeholder="6-digit code"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        maxLength={6}
                        required
                        autoComplete="one-time-code"
                      />
                    </div>
                  )}
                </>
              )}

              <button
                type="submit"
                className="button button-primary w-full"
                disabled={loading}
              >
                {loading
                  ? 'Loading...'
                  : authMethod === 'phone' && !showOtpInput
                    ? 'Send code'
                    : authMethod === 'phone' && showOtpInput
                    ? 'Verify code'
                    : mode === 'signup'
                    ? 'Create account'
                    : 'Sign in'
                }
              </button>
            </form>

            {authMethod === 'phone' && showOtpInput && (
              <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowOtpInput(false);
                    setOtpCode('');
                    setMessage(null);
                    setError(null);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '8pt',
                    color: 'var(--text-muted)',
                    textDecoration: 'underline',
                  }}
                >
                  Back to phone number
                </button>
              </div>
            )}

            {authMethod === 'email' && (
              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '8pt',
                    color: 'var(--text-muted)',
                    textDecoration: 'underline',
                  }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {authMethod === 'phone' && (
              <p style={{ fontSize: '8pt', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
                Phone sign-in creates an account if you don't have one.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
