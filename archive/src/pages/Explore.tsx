
import React, { useEffect } from 'react';
import { ExploreFeed } from '@/components/explore/ExploreFeed';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, LogIn, Car } from "lucide-react";
import { useAuthState } from '@/hooks/auth/use-auth-state';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';

const Explore = () => {
  const { loading, session } = useAuthState();
  const navigate = useNavigate();
  const isAuthenticated = !!session;
  
  // Add error handling
  const [hasError, setHasError] = React.useState(false);
  
  // Reset error state on component mount
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Caught error:', event.error);
      setHasError(true);
    };
    
    // Add global error handler
    window.addEventListener('error', handleError);
    
    return () => {
      window.removeEventListener('error', handleError);
    };
  }, []);
  
  return (
    <div className="container max-w-7xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Explore</h1>
            <Sparkles className="h-5 w-5 text-amber-500" />
          </div>
          <p className="text-muted-foreground">
            Discover personalized content based on your interests and activities
          </p>
        </div>
        
        {!isAuthenticated && (
          <div className="flex flex-col items-end gap-2">
            <Button 
              onClick={() => navigate('/login')} 
              className="flex items-center gap-2"
              size="lg"
              variant="default"
            >
              <LogIn className="h-4 w-4" />
              Sign In
            </Button>
            <p className="text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Car className="h-3 w-3" />
                <span>Sign in to access your vehicle digital identity</span>
              </span>
            </p>
          </div>
        )}
      </div>
      
      {hasError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            There was an error loading the explore content. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      )}
      
      {loading ? (
        <div className="h-[calc(100vh-9rem)] flex items-center justify-center">
          <p className="text-muted-foreground">Loading content...</p>
        </div>
      ) : (
        <ErrorBoundary>
          <ScrollArea className="h-[calc(100vh-9rem)]">
            <ExploreFeed />
          </ScrollArea>
        </ErrorBoundary>
      )}
    </div>
  );
};

// Simple error boundary component
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error in Explore component:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 border rounded-md bg-red-50 text-red-800">
          <h3 className="text-lg font-semibold mb-2">Something went wrong</h3>
          <p>There was a problem loading the explore content. Please try refreshing the page.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default Explore;
