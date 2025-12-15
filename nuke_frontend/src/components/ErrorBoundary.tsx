import React, { Component, ErrorInfo, ReactNode } from 'react';
import type { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKeys?: Array<string | number>;
  resetOnPropsChange?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  eventId: string | null;
}

class ErrorBoundary extends Component<Props, State> {
  private resetTimeoutId: number | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      eventId: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo);

    // Generate a simple error ID for tracking
    const eventId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.setState({
      error,
      errorInfo,
      eventId
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // In production, you might want to send this to an error reporting service
    if (process.env.NODE_ENV === 'production') {
      // Example: Sentry.captureException(error, { contexts: { errorInfo } });
    }
  }

  componentDidUpdate(prevProps: Props) {
    const { resetKeys, resetOnPropsChange } = this.props;
    const { hasError } = this.state;

    // Reset error boundary when resetKeys change
    if (hasError && resetKeys && prevProps.resetKeys) {
      const hasResetKeyChanged = resetKeys.some(
        (resetKey, idx) => resetKey !== prevProps.resetKeys![idx]
      );
      if (hasResetKeyChanged) {
        this.resetErrorBoundary();
      }
    }

    // Reset error boundary when any prop changes (if enabled)
    if (hasError && resetOnPropsChange && prevProps !== this.props) {
      this.resetErrorBoundary();
    }
  }

  resetErrorBoundary = () => {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }

    this.resetTimeoutId = window.setTimeout(() => {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        eventId: null
      });
    }, 100);
  };

  handleRetry = () => {
    this.resetErrorBoundary();
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo, eventId } = this.state;
      const isDevelopment = process.env.NODE_ENV === 'development';

      return (
        <div style={{
          padding: '24px',
          margin: '16px',
          border: '1px solid #dc2626',
          backgroundColor: '#fef2f2',
          borderRadius: '8px',
          fontFamily: 'Arial, sans-serif',
          fontSize: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
            <AlertTriangle style={{ width: '20px', height: '20px', color: '#dc2626', marginRight: '8px' }} />
            <h3 style={{ margin: 0, color: '#dc2626', fontSize: '14px', fontWeight: 'bold' }}>
              Something went wrong
            </h3>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <p style={{ margin: '0 0 8px 0', color: '#374151' }}>
              The application encountered an unexpected error. This has been logged for investigation.
            </p>
            {eventId && (
              <p style={{ margin: '0 0 8px 0', color: '#6b7280', fontSize: '11px' }}>
                Error ID: <code style={{ backgroundColor: 'var(--bg)', padding: '2px 4px', borderRadius: '3px' }}>{eventId}</code>
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: isDevelopment ? '16px' : '0' }}>
            <button
              onClick={this.handleRetry}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                gap: '4px'
              }}
            >
              <RefreshCw style={{ width: '12px', height: '12px' }} />
              Try Again
            </button>

            <button
              onClick={this.handleReload}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                backgroundColor: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                gap: '4px'
              }}
            >
              <RefreshCw style={{ width: '12px', height: '12px' }} />
              Reload Page
            </button>

            <button
              onClick={this.handleGoHome}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                gap: '4px'
              }}
            >
              <Home style={{ width: '12px', height: '12px' }} />
              Go Home
            </button>
          </div>

          {isDevelopment && error && (
            <details style={{ marginTop: '16px' }}>
              <summary style={{
                cursor: 'pointer',
                color: '#dc2626',
                fontSize: '11px',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <Bug style={{ width: '12px', height: '12px' }} />
                Development Error Details
              </summary>
              <div style={{
                marginTop: '8px',
                padding: '12px',
                backgroundColor: '#111827',
                color: '#f9fafb',
                borderRadius: '4px',
                fontSize: '10px',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                overflow: 'auto',
                maxHeight: '200px'
              }}>
                <strong>Error:</strong> {error.name}: {error.message}
                {error.stack && (
                  <>
                    <br /><br />
                    <strong>Stack Trace:</strong>
                    <br />{error.stack}
                  </>
                )}
                {errorInfo && errorInfo.componentStack && (
                  <>
                    <br /><br />
                    <strong>Component Stack:</strong>
                    <br />{errorInfo.componentStack}
                  </>
                )}
              </div>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;