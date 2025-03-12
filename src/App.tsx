import React, { useEffect } from 'react';
import { AppRouter } from './routes/AppRouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, useToast, setToastFunctions } from '@/components/ui/toast/index';
import { TooltipProvider } from '@/components/ui/TooltipProvider';
import OnboardingCheck from '@/components/onboarding/OnboardingCheck';
import ErrorBoundary from '@/components/ErrorBoundary';
import { HelmetProvider } from '@/components/providers/HelmetProvider';

// Create a client with advanced configurations for caching and error handling
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

// Component to initialize global toast functions
function ToastInitializer() {
  const toastMethods = useToast();
  
  useEffect(() => {
    // Set global toast functions for use outside of React components
    if (toastMethods) {
      setToastFunctions(toastMethods);
      console.log('Toast functions initialized');
    }
  }, [toastMethods]);
  
  return null;
}

function App() {
  // Create a persistent helmet context
  const helmetContext = {};

  return (
    <ErrorBoundary>
      <HelmetProvider context={helmetContext}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            {/* Initialize global toast functions */}
            <ToastInitializer />
            
            {/* The AppRouter now contains the BrowserRouter, so OnboardingCheck will work correctly */}
            <AppRouter />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}

export default App;
