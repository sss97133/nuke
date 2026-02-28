import React, { useEffect, useRef } from 'react';

interface TerminalLog {
  id: string;
  message: string;
  timestamp: string;
  type?: 'info' | 'success' | 'error' | 'warning';
}

interface TerminalProps {
  logs: TerminalLog[];
  maxLines?: number;
}

export const Terminal: React.FC<TerminalProps> = ({ logs, maxLines = 10 }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const displayLogs = logs.slice(-maxLines);

  return (
    <div
      ref={containerRef}
      style={{
        fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
        fontSize: '11px',
        background: 'var(--bg)',
        borderTop: '1px solid var(--border)',
        padding: '8px',
        color: 'var(--text)',
        maxHeight: '100px',
        overflowY: 'auto',
        lineHeight: '1.4'
      }}
    >
      {displayLogs.length === 0 ? (
        <div style={{ color: 'var(--text-muted)' }}>{'>'} Ready</div>
      ) : (
        displayLogs.map((log) => (
          <div key={log.id} style={{ marginBottom: '2px' }}>
            <span style={{ color: 'var(--text-muted)' }}>{'>'}</span>{' '}
            <span
              style={{
                color:
                  log.type === 'error'
                    ? 'var(--error)'
                    : log.type === 'success'
                    ? 'var(--success)'
                    : log.type === 'warning'
                    ? 'var(--warning)'
                    : 'var(--text)'
              }}
            >
              {log.message}
            </span>
          </div>
        ))
      )}
    </div>
  );
};

