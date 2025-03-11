import React, { Component, ErrorInfo, ReactNode } from 'react';
import { error as toastError } from '@/components/ui/toast/index';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Enhanced ErrorBoundary component to catch JavaScript errors anywhere in the child component tree,
 * log those errors, and display a fallback UI instead of the component tree that crashed.
 * 
 * Features:
 * - Production-friendly error reporting
 * - Retry mechanism
 * - Home navigation option
 * - Detailed error display in development
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Update state with error details
    this.setState({ errorInfo });
    
    // Log error details
    const isProd = import.meta.env.PROD;
    
    if (!isProd) {
      console.error('Error caught by ErrorBoundary:', error);
      console.error('Component stack:', errorInfo.componentStack);
    } else {
      // In production, log minimal information
      console.error('Application error occurred');
    }
    
    // Call the custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
    
    // Show an error toast notification if available
    try {
      toastError({
        title: 'An error occurred',
        description: 'We encountered a problem. Please try again or refresh the page.',
        duration: 5000,
      });
    } catch (e) {
      // Toast might not be available yet
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleHomeNavigation = (): void => {
    // Navigate to home page and reset the error state
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      const isProd = import.meta.env.PROD;
      const { error, errorInfo } = this.state;
      
      return (
        <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] text-center">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-red-500 dark:text-red-400" />
            </div>
            
            <h2 className="text-xl font-semibold text-red-800 dark:text-red-300 mb-2">
              {isProd ? 'Something went wrong' : 'Application Error'}
            </h2>
            
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              {isProd 
                ? 'We\'re sorry, but an error occurred. Please try again or return to the home page.' 
                : error?.message || 'An unexpected error occurred in the application.'}
            </p>
            
            {/* Show component stack trace only in development */}
            {!isProd && errorInfo && (
              <div className="mb-6 overflow-auto max-h-40 text-left bg-gray-100 dark:bg-gray-800 p-2 rounded text-xs">
                <pre className="whitespace-pre-wrap break-words text-red-600 dark:text-red-400">
                  {errorInfo.componentStack}
                </pre>
              </div>
            )}
            
            <div className="flex justify-center gap-3">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors text-sm"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Try Again</span>
              </button>
              
              <button
                onClick={this.handleHomeNavigation}
                className="flex items-center gap-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md transition-colors text-sm"
              >
                <Home className="h-4 w-4" />
                <span>Go to Home</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
