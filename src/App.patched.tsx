import React, { useEffect } from 'react';
import { AppRouter } from './routes/AppRouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, useToast, setToastFunctions } from '@/components/ui/toast/index';
import { TooltipProvider } from '@/components/ui/TooltipProvider';
import OnboardingCheck from '@/components/onboarding/OnboardingCheck';
import ErrorBoundary from '@/components/ErrorBoundary';
import { HelmetProvider } from '@/components/providers/HelmetProvider';
import StyleFix from './fixes/ensure-styles';
import { SimpleAdaptivePanel } from './components/ui/SimpleAdaptivePanel';
import { getEnvValue, checkRequiredEnvVars } from './utils/env-utils';

// Import our mock enabler to prevent WebSocket connection errors
import './integrations/utils/mock-enabler';

// Import enhanced component styles
import './styles/component-classes.css';

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
  }, [toastMethods]); // Only run this effect when toastMethods changes
  
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
            {/* Initialize toast functions for global use */}
            <ToastInitializer />
            
            {/* Main application router */}
            <AppRouter />
            
            {/* Global toast container */}
            <Toaster />
            
            {/* Onboarding check component */}
            <OnboardingCheck />
            
            {/* Style fixes for consistent appearance */}
            <StyleFix />
            
            {/* Adaptive panel for responsive UI */}
            <SimpleAdaptivePanel />
          </TooltipProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}

export default App;
