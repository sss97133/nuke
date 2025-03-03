
import React, { useEffect } from 'react';
import TheoremExplainAgent from '@/components/analytics/TheoremExplainAgent';

const Analytics = () => {
  useEffect(() => {
    console.log("Analytics page mounting");
    return () => console.log("Analytics page unmounting");
  }, []);
  
  console.log("Analytics page rendering");
  
  return (
    <div className="container py-6">
      <h1 className="text-3xl font-bold mb-8">Analytics Dashboard</h1>
      
      <div className="space-y-8">
        {/* Add a simple static element to verify rendering */}
        <div className="p-4 bg-blue-100 rounded-md">
          <p className="text-blue-800 font-medium">Theorem Explain Agent Panel</p>
        </div>
        
        <ErrorBoundary>
          <TheoremExplainAgent />
        </ErrorBoundary>
      </div>
    </div>
  );
};

// Simple error boundary component to catch errors in children
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught in ErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 border border-red-300 rounded bg-red-50">
          <h3 className="text-red-800 font-medium mb-2">Something went wrong in TheoremExplainAgent</h3>
          <pre className="text-sm bg-red-100 p-2 rounded whitespace-pre-wrap">
            {this.state.error?.toString()}
          </pre>
          <button 
            className="mt-2 px-3 py-1 bg-red-200 text-red-800 rounded"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default Analytics;
