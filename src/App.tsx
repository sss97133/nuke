
import React, { useEffect } from 'react';
import { AppRouter } from './routes/AppRouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, useToast, setToastFunctions } from '@/components/ui/toast/index';
import { TooltipProvider } from '@/components/ui/TooltipProvider';
import OnboardingCheck from '@/components/onboarding/OnboardingCheck';
import ErrorBoundary from '@/components/ErrorBoundary';

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

// Set up global error handlers on the queryClient
queryClient.setDefaultOptions({
  queries: {
    onError: (error) => {
      console.error('Query error:', error);
    }
  },
  mutations: {
    onError: (error) => {
      console.error('Mutation error:', error);
    }
  }
});

// Component to initialize global toast functions
function ToastInitializer() {
  const { toast } = useToast();
  
  useEffect(() => {
    // Set global toast functions for use outside of React components
    setToastFunctions(toast);
  }, [toast]);
  
  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {/* Initialize global toast functions */}
          <ToastInitializer />
          
          {/* The AppRouter now contains the BrowserRouter, so OnboardingCheck will work correctly */}
          <AppRouter />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
