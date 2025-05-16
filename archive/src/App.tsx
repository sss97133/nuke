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
import { SupabaseRealtimeProvider } from "@/integrations/supabase/SupabaseRealtimeProvider";
import WebSocketDiagnostics from './integrations/utils/WebSocketDiagnostics';
// Production imports only - no test components
import AuthDebug from './components/debug/AuthDebug';
import { VehicleProvider } from '@/providers/VehicleProvider';

// Import environment fix to ensure proper Supabase connectivity
import './fix-env';

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
            
            {/* Provide vehicle context to the entire application */}
            <VehicleProvider>
              {/* Add Supabase Realtime Provider for WebSocket connection management */}
              <SupabaseRealtimeProvider debug={true}>
                {/* Add WebSocket diagnostics for debugging */}
                <WebSocketDiagnostics />
                
                {/* Ensure styles are loaded properly in production */}
                <StyleFix />
                
                {/* Adaptive UI Panel that learns from user behavior */}
                <SimpleAdaptivePanel />
                
                <main className="flex-1 overflow-auto relative">
                  <AppRouter />
                </main>
                <Toaster />
                {/* Add AuthDebug component for dev environment */}
                <AuthDebug />
              </SupabaseRealtimeProvider>
            </VehicleProvider>
          </TooltipProvider>
          {/* No test components in production */}
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}

export default App;
