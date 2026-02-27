import React from 'react';
import type { PortalDataState } from './useMicroPortalData';

/**
 * PortalShell — shared frame for all MicroPortal content panels.
 * Handles loading spinner, error display, and empty-state invitations.
 */

interface PortalShellProps {
  title: string;
  isLoading: boolean;
  error: string | null;
  state: PortalDataState;
  /** Content for the empty invitation state */
  emptyContent?: React.ReactNode;
  /** Content for sparse data (1-2 points) */
  sparseContent?: React.ReactNode;
  /** Content for rich data (3+ points) */
  richContent?: React.ReactNode;
  /** Override: render custom content regardless of state */
  children?: React.ReactNode;
}

export default function PortalShell({
  title,
  isLoading,
  error,
  state,
  emptyContent,
  sparseContent,
  richContent,
  children,
}: PortalShellProps) {
  return (
    <div style={{ padding: '10px 12px' }}>
      {/* Header */}
      <div style={{
        fontSize: '9px',
        fontWeight: 700,
        color: 'var(--text-muted, #6b7280)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: '8px',
      }}>
        {title}
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px 0',
          color: 'var(--text-muted)',
          fontSize: '11px',
          gap: '6px',
        }}>
          <span style={{
            display: 'inline-block',
            width: '12px',
            height: '12px',
            border: '2px solid var(--border)',
            borderTopColor: 'var(--primary, #3b82f6)',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
          }} />
          Loading...
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div style={{
          padding: '8px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#dc2626',
        }}>
          {error}
        </div>
      )}

      {/* Content by state */}
      {!isLoading && !error && (
        children || (
          <>
            {state === 'empty' && emptyContent}
            {state === 'sparse' && (sparseContent || emptyContent)}
            {state === 'rich' && (richContent || sparseContent || emptyContent)}
          </>
        )
      )}
    </div>
  );
}
