import React from 'react';
import { HelmetProvider as ReactHelmetProvider, HelmetServerState } from 'react-helmet-async';

interface HelmetProviderProps {
  children: React.ReactNode;
  context?: { helmet?: HelmetServerState };
}

export function HelmetProvider({ children, context }: HelmetProviderProps) {
  // Create a persistent helmet context that can be used for SSR
  const helmetContext = context || { helmet: undefined };
  
  return (
    <ReactHelmetProvider context={helmetContext}>
      {children}
    </ReactHelmetProvider>
  );
}
