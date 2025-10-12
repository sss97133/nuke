import React from 'react';
import ErrorBoundary from '../ErrorBoundary';
import type { Car, AlertTriangle, RefreshCw } from 'lucide-react';

interface VehicleErrorBoundaryProps {
  children: React.ReactNode;
  vehicleId?: string;
  componentName?: string;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

const VehicleErrorFallback: React.FC<{
  vehicleId?: string;
  componentName?: string;
  onRetry?: () => void;
}> = ({ vehicleId, componentName, onRetry }) => (
  <div style={{
    padding: '16px',
    margin: '8px 0',
    border: '1px solid #f59e0b',
    backgroundColor: '#fef3c7',
    borderRadius: '4px',
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px'
  }}>
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
      <AlertTriangle style={{ width: '16px', height: '16px', color: '#f59e0b', marginRight: '6px' }} />
      <h4 style={{ margin: 0, color: '#92400e', fontSize: '12px', fontWeight: 'bold' }}>
        Vehicle Component Error
      </h4>
    </div>

    <div style={{ marginBottom: '12px', color: '#92400e' }}>
      {componentName ? (
        <p style={{ margin: '0 0 4px 0' }}>
          Failed to load <strong>{componentName}</strong> component
        </p>
      ) : (
        <p style={{ margin: '0 0 4px 0' }}>
          Failed to load vehicle component
        </p>
      )}

      {vehicleId && (
        <p style={{ margin: 0, fontSize: '10px', opacity: 0.8 }}>
          Vehicle ID: {vehicleId}
        </p>
      )}
    </div>

    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 8px',
            backgroundColor: '#f59e0b',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            fontSize: '10px',
            cursor: 'pointer',
            gap: '3px'
          }}
        >
          <RefreshCw style={{ width: '10px', height: '10px' }} />
          Retry
        </button>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        color: '#92400e',
        fontSize: '10px'
      }}>
        <Car style={{ width: '12px', height: '12px' }} />
        <span>Vehicle system error</span>
      </div>
    </div>
  </div>
);

const VehicleErrorBoundary: React.FC<VehicleErrorBoundaryProps> = ({
  children,
  vehicleId,
  componentName,
  onError
}) => {
  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    // Log vehicle-specific error context
    console.error(`Vehicle component error in ${componentName || 'unknown component'}:`, {
      vehicleId,
      componentName,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });

    // Call parent error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }
  };

  return (
    <ErrorBoundary
      onError={handleError}
      resetKeys={[vehicleId]}
      resetOnPropsChange={false}
      fallback={
        <VehicleErrorFallback
          vehicleId={vehicleId}
          componentName={componentName}
        />
      }
    >
      {children}
    </ErrorBoundary>
  );
};

export default VehicleErrorBoundary;