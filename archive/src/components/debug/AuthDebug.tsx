import React from 'react';
import { useAuth } from '@/contexts/auth/AuthProvider';

const AuthDebug: React.FC = () => {
  const { user, session, loading } = useAuth();

  // Only render this component in development mode
  if (import.meta.env.MODE !== 'development') {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '10px',
        right: '10px',
        padding: '15px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        borderRadius: '8px',
        zIndex: 10000, // Ensure it's on top
        maxWidth: '400px',
        maxHeight: '300px',
        overflow: 'auto',
        fontSize: '12px',
        fontFamily: 'monospace',
      }}
    >
      <h4>Auth State (Dev Only)</h4>
      <p>Loading: {loading.toString()}</p>
      <div>
        <p>User:</p>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {user ? JSON.stringify(user, null, 2) : 'null'}
        </pre>
      </div>
      <div>
        <p>Session:</p>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {session ? JSON.stringify(session, null, 2) : 'null'}
        </pre>
      </div>
    </div>
  );
};

export default AuthDebug;
