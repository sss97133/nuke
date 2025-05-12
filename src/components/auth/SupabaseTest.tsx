import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function SupabaseTest() {
  const [status, setStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [errorMessage, setErrorMessage] = useState('');
  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function checkConnection() {
      try {
        // Simple table query to test connection
        const { error } = await supabase.from('profiles').select('count').limit(1);
        
        if (error) {
          console.error('Supabase connection error:', error);
          setStatus('error');
          setErrorMessage(error.message);
          return;
        }
        
        setStatus('connected');
        
        // Check current user
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          setUser(data.user);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setStatus('error');
        setErrorMessage(String(err));
      }
    }
    
    checkConnection();
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      
      if (error) {
        setMessage(`Error: ${error.message}`);
      } else if (data?.user) {
        setUser(data.user);
        setMessage('Signed in successfully');
      }
    } catch (err) {
      setMessage(`Unexpected error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });
      
      if (error) {
        setMessage(`Error: ${error.message}`);
      } else {
        setMessage('Check your email for the confirmation link');
      }
    } catch (err) {
      setMessage(`Unexpected error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`
      });
      
      if (error) {
        setMessage(`Error: ${error.message}`);
      } else {
        setMessage('Password reset email sent');
      }
    } catch (err) {
      setMessage(`Unexpected error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    
    try {
      await supabase.auth.signOut();
      setUser(null);
      setMessage('Logged out successfully');
    } catch (err) {
      setMessage(`Unexpected error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      maxWidth: '800px', 
      margin: '0 auto', 
      padding: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#f7f7f7',
      borderRadius: '8px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
    }}>
      <h1 style={{ marginBottom: '20px', color: '#333' }}>Supabase Connection Test</h1>
      
      {/* Connection Status */}
      <div style={{ 
        padding: '15px', 
        marginBottom: '20px', 
        borderRadius: '4px',
        backgroundColor: status === 'connected' ? '#e6f7e6' : status === 'error' ? '#ffebee' : '#e3f2fd',
        color: status === 'connected' ? '#2e7d32' : status === 'error' ? '#c62828' : '#0277bd',
      }}>
        <h2 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>
          Status: {status === 'checking' ? 'Checking connection...' : status === 'connected' ? 'Connected to Supabase' : 'Connection Error'}
        </h2>
        {status === 'error' && (
          <div>
            <p style={{ margin: '0', color: '#c62828' }}>{errorMessage}</p>
            <p style={{ marginTop: '10px' }}>
              <strong>Troubleshooting:</strong>
              <ul>
                <li>Check .env.local file for correct credentials</li>
                <li>Verify Supabase project is active</li>
                <li>Check browser console for additional errors</li>
              </ul>
            </p>
          </div>
        )}
        <p style={{ marginTop: '10px', fontSize: '14px' }}>
          Project URL: {import.meta.env.VITE_SUPABASE_URL || 'Not found in environment'}
        </p>
      </div>

      {/* Message display */}
      {message && (
        <div style={{
          padding: '10px',
          marginBottom: '20px',
          backgroundColor: message.includes('Error') ? '#ffebee' : '#e6f7e6',
          borderRadius: '4px'
        }}>
          {message}
        </div>
      )}

      {/* User Info */}
      {user ? (
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#e8f5e9', borderRadius: '4px' }}>
          <h2 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>Currently Logged In</h2>
          <p><strong>Email:</strong> {user.email}</p>
          <p><strong>User ID:</strong> {user.id}</p>
          <button 
            onClick={handleLogout}
            disabled={loading}
            style={{
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {loading ? 'Loading...' : 'Sign Out'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Login Form */}
          <div style={{ padding: '15px', backgroundColor: '#fff', borderRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>Sign In</h2>
            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input 
                type="email" 
                placeholder="Email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
              <input 
                type="password" 
                placeholder="Password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
              <button 
                type="submit" 
                disabled={loading}
                style={{
                  backgroundColor: '#2196f3',
                  color: 'white',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {loading ? 'Loading...' : 'Sign In'}
              </button>
            </form>
          </div>

          {/* Sign Up Form */}
          <div style={{ padding: '15px', backgroundColor: '#fff', borderRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>Sign Up</h2>
            <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input 
                type="email" 
                placeholder="Email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
              <input 
                type="password" 
                placeholder="Password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
              <button 
                type="submit" 
                disabled={loading}
                style={{
                  backgroundColor: '#4caf50',
                  color: 'white',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {loading ? 'Loading...' : 'Sign Up'}
              </button>
            </form>
          </div>

          {/* Password Reset Form */}
          <div style={{ padding: '15px', backgroundColor: '#fff', borderRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>Reset Password</h2>
            <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input 
                type="email" 
                placeholder="Email" 
                value={resetEmail} 
                onChange={(e) => setResetEmail(e.target.value)}
                required
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
              <button 
                type="submit" 
                disabled={loading}
                style={{
                  backgroundColor: '#ff9800',
                  color: 'white',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {loading ? 'Loading...' : 'Send Reset Link'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Technical Details */}
      <div style={{ marginTop: '30px', padding: '15px', backgroundColor: '#fff', borderRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h2 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>Technical Details</h2>
        <p style={{ fontFamily: 'monospace', fontSize: '14px', lineHeight: '1.5', backgroundColor: '#f5f5f5', padding: '10px', borderRadius: '4px', overflowX: 'auto' }}>
          <strong>Window Location:</strong> {window.location.href}<br />
          <strong>Auth Redirect URL:</strong> {`${window.location.origin}/auth/callback`}<br />
          <strong>Reset Redirect URL:</strong> {`${window.location.origin}/auth/callback?type=recovery`}<br />
        </p>
      </div>
    </div>
  );
}
