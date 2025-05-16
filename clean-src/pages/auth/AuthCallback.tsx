import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase-client';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthCallback = async () => {
      // Get the URL hash and search params
      const hash = window.location.hash;
      const query = window.location.search;

      if (hash || query) {
        try {
          // Process the session from the URL
          const { data, error } = await supabase.auth.getSession();
          
          if (error) {
            console.error('Error processing auth callback:', error);
            navigate('/auth', { replace: true });
            return;
          }
          
          if (data?.session) {
            console.log('Auth callback processed successfully');
            navigate('/dashboard', { replace: true });
          } else {
            navigate('/auth', { replace: true });
          }
        } catch (error) {
          console.error('Error in auth callback:', error);
          navigate('/auth', { replace: true });
        }
      } else {
        // No hash or query - redirect to auth page
        navigate('/auth', { replace: true });
      }
    };

    handleAuthCallback();
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
        <p className="mt-4 text-gray-600">Processing your login...</p>
      </div>
    </div>
  );
};

export default AuthCallback;
