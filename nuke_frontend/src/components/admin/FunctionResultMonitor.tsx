import React, { useState } from 'react';

interface FunctionInvocation {
  id: string;
  functionName: string;
  timestamp: Date;
  request: {
    url: string;
    method: string;
    body?: any;
    headers?: Record<string, string>;
  };
  response: {
    status: number;
    statusText?: string;
    data?: any;
    error?: any;
  };
  duration?: number;
  success: boolean;
}

interface FunctionResultMonitorProps {
  invocation: FunctionInvocation | null;
  functionName: string;
  isRunning?: boolean;
}

export const FunctionResultMonitor: React.FC<FunctionResultMonitorProps> = ({
  invocation,
  functionName,
  isRunning = false,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (!invocation && !isRunning) {
    return null;
  }

  const getStatusColor = () => {
    if (isRunning) return 'var(--text-muted)';
    if (!invocation) return 'var(--text-muted)';
    if (invocation.success) return 'var(--success)';
    return 'var(--error)';
  };

  const getStatusText = () => {
    if (isRunning) return 'RUNNING';
    if (!invocation) return 'PENDING';
    if (invocation.success) return 'SUCCESS';
    return 'FAILED';
  };

  return (
    <div
      style={{
        marginTop: 'var(--space-3)',
        border: '2px solid var(--border)',
        backgroundColor: 'var(--white)',
        fontSize: '8pt',
      }}
    >
      <div
        style={{
          padding: 'var(--space-3)',
          borderBottom: expanded ? '2px solid var(--border)' : 'none',
          backgroundColor: 'var(--grey-100)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: invocation ? 'pointer' : 'default',
        }}
        onClick={() => invocation && setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{functionName}</div>
          {invocation && (
            <>
              <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>
                {invocation.timestamp.toLocaleString()}
              </div>
              {invocation.duration && (
                <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>
                  {invocation.duration}ms
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <div
            style={{
              padding: '2px var(--space-2)',
              backgroundColor: getStatusColor(),
              color: 'var(--white)',
              fontWeight: 600,
              fontSize: '8pt',
            }}
          >
            {getStatusText()}
          </div>
          {invocation && (
            <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>
              {expanded ? '▼' : '▶'}
            </div>
          )}
        </div>
      </div>

      {expanded && invocation && (
        <div style={{ padding: 'var(--space-3)' }}>
          {/* Response Summary */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div
              style={{
                fontSize: '8pt',
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: 'var(--space-2)',
              }}
            >
              RESPONSE
            </div>
            <div
              style={{
                padding: 'var(--space-2)',
                backgroundColor: 'var(--grey-100)',
                border: '1px solid var(--border-light)',
                fontSize: '8pt',
                fontFamily: 'var(--font-mono)',
                overflowX: 'auto',
              }}
            >
              {invocation.response.error ? (
                <div style={{ color: 'var(--error)' }}>
                  {JSON.stringify(invocation.response.error, null, 2)}
                </div>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    fontSize: '8pt',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(invocation.response.data, null, 2)}
                </pre>
              )}
            </div>
          </div>

          {/* Request Details */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div
              style={{
                fontSize: '8pt',
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: 'var(--space-2)',
              }}
            >
              REQUEST
            </div>
            <div
              style={{
                padding: 'var(--space-2)',
                backgroundColor: 'var(--grey-100)',
                border: '1px solid var(--border-light)',
                fontSize: '8pt',
              }}
            >
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <span style={{ fontWeight: 600 }}>URL:</span>{' '}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8pt' }}>
                  {invocation.request.url}
                </span>
              </div>
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <span style={{ fontWeight: 600 }}>Method:</span> {invocation.request.method}
              </div>
              {invocation.request.body && (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>Body:</div>
                  <pre
                    style={{
                      margin: 0,
                      fontSize: '8pt',
                      fontFamily: 'var(--font-mono)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      padding: 'var(--space-2)',
                      backgroundColor: 'var(--white)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    {JSON.stringify(invocation.request.body, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* Response Status */}
          <div>
            <div
              style={{
                fontSize: '8pt',
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: 'var(--space-2)',
              }}
            >
              STATUS
            </div>
            <div
              style={{
                padding: 'var(--space-2)',
                backgroundColor: 'var(--grey-100)',
                border: '1px solid var(--border-light)',
                fontSize: '8pt',
              }}
            >
              <div>
                <span style={{ fontWeight: 600 }}>Status Code:</span> {invocation.response.status}
                {invocation.response.statusText && ` ${invocation.response.statusText}`}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

