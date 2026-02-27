/**
 * AuthErrorBoundary — catches RLS / 401 errors that bubble up from pages
 * and renders a user-friendly "sign in required" message instead of a
 * blank page or uncaught exception.
 *
 * Usage: wrap any page that calls authenticated APIs:
 *   <AuthErrorBoundary>
 *     <MyPage />
 *   </AuthErrorBoundary>
 *
 * Or use the helper `isAuthError(error)` to detect 401/403 inline.
 */

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// ── Inline helper ────────────────────────────────────────────────────────────

/** Returns true for Supabase 401/403 errors and PGRST RLS violations. */
export function isAuthError(error: unknown): boolean {
  if (!error) return false;
  const e = error as any;
  // Supabase client: { status: 401 } or { code: 'PGRST301' } or { message: '...' }
  if (e.status === 401 || e.status === 403) return true;
  // PostgREST RLS violations
  if (typeof e.code === 'string' && (e.code.startsWith('PGRST3') || e.code === '42501')) return true;
  // HTTP fetch style
  if (typeof e.message === 'string') {
    const m = e.message.toLowerCase();
    if (m.includes('jwt') || m.includes('unauthorized') || m.includes('not authenticated')) return true;
  }
  return false;
}

// ── Inline "sign in" nudge ───────────────────────────────────────────────────

interface AuthErrorCardProps {
  message?: string;
}

export function AuthErrorCard({ message }: AuthErrorCardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '40vh',
      padding: '24px',
    }}>
      <div style={{
        maxWidth: '360px',
        border: '2px solid var(--border-light)',
        padding: '24px',
        backgroundColor: 'var(--white)',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
          Sign in required
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          {message ?? 'You need to be signed in to view this page.'}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="button"
            onClick={() => navigate(`/login?next=${next}`)}
          >
            Sign in
          </button>
          <button
            className="button button-secondary"
            onClick={() => navigate('/')}
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Class-based error boundary ───────────────────────────────────────────────

interface State {
  hasError: boolean;
  isAuthError: boolean;
}

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export class AuthErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, isAuthError: false };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      isAuthError: isAuthError(error),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[AuthErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.state.isAuthError) {
        // Will be rendered inside a Router so useNavigate is available
        return <AuthErrorCardWrapper />;
      }
      // Re-throw to the outer ErrorBoundary
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

// Wrapper to use hooks (class component can't call hooks directly)
function AuthErrorCardWrapper() {
  return <AuthErrorCard />;
}
