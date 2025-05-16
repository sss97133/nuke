import React, { useEffect, useState } from 'react';
import { checkAuthentication } from '../lib/supabase'; // Adjusted path

interface AuthStatusState {
  isAuthenticated: boolean;
  userId: string | null;
  error: Error | null;
}

export function AuthStatus() {
  const [status, setStatus] = useState<AuthStatusState>({
    isAuthenticated: false,
    userId: null,
    error: null,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      setLoading(true);
      const result = await checkAuthentication();
      // Ensure error is of type Error | null
      const finalError = result.error instanceof Error ? result.error : null;
      // Ensure userId is string | null
      const finalUserId = typeof result.userId === 'string' ? result.userId : null;
      setStatus({ 
        isAuthenticated: result.isAuthenticated,
        userId: finalUserId, // Use the corrected userId
        error: finalError 
      });
      setLoading(false);
    };

    checkAuth();
  }, []);

  if (loading) return <div className="p-2">Checking authentication...</div>;

  return (
    <div className="auth-status p-2 bg-gray-100 rounded border border-gray-200 text-sm">
      <h3 className="font-semibold mb-1">Authentication Status</h3>
      <p>Status: {status.isAuthenticated ? '✅ Authenticated' : '❌ Not authenticated'}</p>
      {status.userId && <p>User ID: <code className="text-xs bg-gray-200 px-1 rounded">{status.userId}</code></p>}
      {status.error && <p className="text-red-500">Error: {status.error.message}</p>}
    </div>
  );
} 