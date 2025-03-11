import React, { lazy, Suspense, useEffect } from 'react';
import { AppRouter } from './routes/AppRouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, useToast, setToastFunctions } from '@/components/ui/toast/index';
import { TooltipProvider } from '@/components/ui/TooltipProvider';
import ErrorBoundary from '@/components/ErrorBoundary';

// Create a client with optimized configurations for production
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
      // Add cache time to reduce API calls
      cacheTime: 10 * 60 * 1000, // 10 minutes
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
      
      // Remove console.log in production for better performance
      if (import.meta.env.DEV) {
        console.log('Toast functions initialized');
      }
    }
  }, [toastMethods]);
  
  return null;
}

// Loading component for suspense fallback
const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-pulse flex flex-col items-center p-4">
      <div className="h-12 w-12 bg-primary/20 rounded-full mb-4"></div>
      <div className="h-4 w-40 bg-muted rounded mb-2"></div>
      <div className="h-3 w-28 bg-muted/50 rounded"></div>
    </div>
  </div>
);

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {/* Initialize global toast functions */}
          <ToastInitializer />
          
          <Suspense fallback={<LoadingFallback />}>
            <AppRouter />
          </Suspense>
          
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
