
import React from 'react';
import { HelmetProvider as ReactHelmetProvider } from 'react-helmet-async';

interface HelmetProviderProps {
  children: React.ReactNode;
}

export function HelmetProvider({ children }: HelmetProviderProps) {
  // Create a new helmet context
  const helmetContext = {};
  
  return (
    <ReactHelmetProvider context={helmetContext}>
      {children}
    </ReactHelmetProvider>
  );
}
