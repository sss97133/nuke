import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

// TEMPORARY BYPASS - Remove when auth is fixed
export const BYPASS_USER_ID = '11111111-1111-1111-1111-111111111111';
const BYPASS_USER = {
  id: BYPASS_USER_ID,
  email: 'skylar@gmail.com',
  role: 'authenticated',
  aud: 'authenticated'
};

const BypassLogin = () => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>('');
  const navigate = useNavigate();

  const handleBypassLogin = async () => {
    setLoading(true);
    setMessage('');

    try {
      // First, ensure the profile exists
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: BYPASS_USER.id,
          email: BYPASS_USER.email,
          username: 'skylar',
          full_name: 'Skylar Williams',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        });

      if (profileError) {
        console.error('Profile creation error:', profileError);
        setMessage('Could not create profile: ' + profileError.message);
        setLoading(false);
        return;
      }

      // Store a fake session in localStorage that components will check
      const fakeSession = {
        access_token: 'bypass-token-' + Date.now(),
        refresh_token: 'bypass-refresh-' + Date.now(),
        expires_at: Date.now() + 3600000, // 1 hour from now
        user: BYPASS_USER
      };

      // Store in localStorage to persist across refreshes
      localStorage.setItem('bypass-session', JSON.stringify(fakeSession));
      
      // Override the Supabase auth methods temporarily
      const originalGetSession = supabase.auth.getSession;
      const originalGetUser = supabase.auth.getUser;
      const originalOnAuthStateChange = supabase.auth.onAuthStateChange;
      
      // Monkey-patch the auth methods
      (supabase.auth as any).getSession = async () => ({
        data: { session: { ...fakeSession, expires_in: 3600 } },
        error: null
      });

      (supabase.auth as any).getUser = async () => ({
        data: { user: BYPASS_USER },
        error: null
      });

      (supabase.auth as any).onAuthStateChange = (callback: any) => {
        // Immediately call the callback with the fake session
        if (callback) {
          callback('SIGNED_IN', { ...fakeSession, expires_in: 3600 });
        }
        // Return a fake subscription
        return {
          data: { subscription: { unsubscribe: () => {} } }
        };
      };

      setMessage('Bypass login successful! Redirecting...');
      
      // Force a page reload to reinitialize auth state
      setTimeout(() => {
        window.location.href = '/vehicles';
      }, 500);
      
    } catch (error: any) {
      console.error('Bypass login error:', error);
      setMessage('Bypass login failed: ' + error.message);
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      padding: '20px',
      background: '#fff3cd',
      border: '2px solid #ffc107',
      borderRadius: '4px',
      marginTop: '20px'
    }}>
      <h3 style={{ marginTop: 0, color: '#856404' }}>⚠️ Emergency Bypass Login</h3>
      <p style={{ color: '#856404', fontSize: '14px' }}>
        The authentication system is currently broken. This bypass will create a temporary session 
        so you can use the app. Your data will be saved under a test user ID.
      </p>
      <button
        onClick={handleBypassLogin}
        className="button button-primary"
        disabled={loading}
        style={{ marginTop: '10px' }}
      >
        {loading ? 'Creating bypass session...' : 'Bypass Login (Temporary)'}
      </button>
      {message && (
        <p style={{ 
          marginTop: '10px', 
          color: message.includes('successful') ? 'green' : 'red',
          fontSize: '14px'
        }}>
          {message}
        </p>
      )}
    </div>
  );
};

export default BypassLogin;
