import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';

/** Route state and query results belong to one resolved viewer, including visitors. */
export function ViewerWorkspace({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <>{fallback}</>;
  return <ResolvedWorkspace key={user?.id ?? 'anonymous'}>{children}</ResolvedWorkspace>;
}

function ResolvedWorkspace({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 1 } },
  }));
  const lifecycle = useRef(0);

  useEffect(() => {
    const mounted = ++lifecycle.current;
    return () => {
      // StrictMode replays effects on the same mounted client. Clear only a
      // detached workspace; clear() also cancels its pending query retries.
      queueMicrotask(() => { if (lifecycle.current === mounted) client.clear(); });
    };
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
