import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import ForgotPasswordForm from '../auth/ForgotPasswordForm';
import BypassLogin from './BypassLogin';
import '../../design-system.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

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

            if (signUpError) throw signUpError;

            // Try to sign in again after creating account
            const { error: retryError, data: { user: retryUser } = { user: null } } = await supabase.auth.signInWithPassword({
              email,
              password,
            });

            if (retryError) throw retryError;
            if (retryUser) {
              console.log('Account created and login successful, navigating to vehicles');
              const returnUrl = searchParams.get('returnUrl') || '/vehicles';
              navigate(returnUrl);
            }
          } else if (signInError) {
            throw signInError;
          } else if (user) {
            console.log('Login successful, navigating to vehicles');
            const returnUrl = searchParams.get('returnUrl') || '/vehicles';
            navigate(returnUrl);
          }
        } else {
          // Sign up with email and password
          const { error } = await supabase.auth.signUp({
            email,
            password,
          });

          if (error) throw error;

          setMessage('Check your email for the confirmation link');
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
            console.log('Phone authentication successful, navigating to vehicles');
            const returnUrl = searchParams.get('returnUrl') || '/vehicles';
            navigate(returnUrl);
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
      
      // For remote Supabase, let it handle the redirect automatically
      // For local development, specify the local callback
      const isLocalSupabase = import.meta.env.VITE_SUPABASE_URL?.includes('localhost');
      const options = isLocalSupabase 
        ? { redirectTo: `${window.location.origin}/auth/callback` }
        : {}; // Let Supabase handle the redirect for remote instances
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options
      });
      
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Failed to login with GitHub');
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
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 className="heading-1" style={{ marginBottom: '8px' }}>Nuke</h1>
              <p className="text text-muted">Vehicle Digital Identity Platform</p>
            </div>
            
            
            {error && (
              <div className="alert alert-error" style={{ marginBottom: '24px' }}>
                {error}
              </div>
            )}
            
            {message && (
              <div className="alert alert-success" style={{ marginBottom: '24px' }}>
                {message}
              </div>
            )}
            
            <button
              onClick={handleGitHubLogin}
              className="button button-secondary w-full"
              disabled={loading}
              style={{ marginBottom: '16px' }}
            >
              {loading ? 'Connecting...' : 'Continue with GitHub'}
            </button>
            
            <div style={{ textAlign: 'center', margin: '16px 0', color: '#666' }}>
              or
            </div>

            {/* Auth method selector */}
            <div style={{ display: 'flex', marginBottom: '16px', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
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
                  padding: '8px 12px',
                  border: 'none',
                  borderRadius: '6px 0 0 6px',
                  backgroundColor: authMethod === 'email' ? '#3b82f6' : 'transparent',
                  color: authMethod === 'email' ? 'white' : '#6b7280',
                  cursor: 'pointer'
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
                  padding: '8px 12px',
                  border: 'none',
                  borderRadius: '0 6px 6px 0',
                  backgroundColor: authMethod === 'phone' ? '#3b82f6' : 'transparent',
                  color: authMethod === 'phone' ? 'white' : '#6b7280',
                  cursor: 'pointer'
                }}
              >
                Phone
              </button>
            </div>

            <form onSubmit={handleAuth} style={{ marginBottom: '24px' }}>
              {authMethod === 'email' ? (
                <>
                  <div style={{ marginBottom: '16px' }}>
                    <input
                      type="email"
                      className="input"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div style={{ marginBottom: '24px' }}>
                    <input
                      type="password"
                      className="input"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ marginBottom: '16px' }}>
                    <input
                      type="tel"
                      className="input"
                      placeholder="Phone number (e.g., +1234567890)"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                  </div>

                  {showOtpInput && (
                    <div style={{ marginBottom: '16px' }}>
                      <input
                        type="text"
                        className="input"
                        placeholder="Enter OTP code"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        maxLength={6}
                        required
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
                    ? 'Send OTP'
                    : authMethod === 'phone' && showOtpInput
                    ? 'Verify OTP'
                    : 'Continue'
                }
              </button>
            </form>

            {authMethod === 'phone' && showOtpInput && (
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowOtpInput(false);
                    setOtpCode('');
                    setMessage(null);
                    setError(null);
                  }}
                  className="text text-muted"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  ← Back to phone number
                </button>
              </div>
            )}
            
            <div style={{ textAlign: 'center' }}>
              {authMethod === 'email' && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(true)}
                    className="text text-muted"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', marginRight: '16px' }}
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
                    className="text text-muted"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {mode === 'signin' ? 'Create account' : 'Sign in instead'}
                  </button>
                </>
              )}
              {authMethod === 'phone' && (
                <p className="text text-muted" style={{ fontSize: '14px', margin: 0 }}>
                  Phone authentication will create an account if one doesn't exist
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
