import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Auth as SupabaseAuth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '@/lib/supabase-client';

interface AuthProps {
  redirectTo?: string;
}

const Auth: React.FC<AuthProps> = ({ redirectTo = '/dashboard' }) => {
  const navigate = useNavigate();
  
  // Setup auth state change listener
  React.useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        navigate(redirectTo);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate, redirectTo]);

  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-gray-50">
      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md">
        <h2 className="text-2xl font-bold text-center mb-6">Welcome to Nuke</h2>
        <SupabaseAuth 
          supabaseClient={supabase} 
          appearance={{ 
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: '#0070f3',
                  brandAccent: '#0050d0',
                }
              }
            }
          }}
          providers={['google', 'github']}
          redirectTo={`${window.location.origin}${redirectTo}`}
        />
      </div>
    </div>
  );
};

export default Auth;
