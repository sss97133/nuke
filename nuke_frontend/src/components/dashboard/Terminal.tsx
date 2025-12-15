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
        fontSize: '8pt',
        background: 'var(--bg)',
        borderTop: '1px solid #bdbdbd',
        padding: '8px',
        color: '#424242',
        maxHeight: '100px',
        overflowY: 'auto',
        lineHeight: '1.4'
      }}
    >
      {displayLogs.length === 0 ? (
        <div style={{ color: '#9e9e9e' }}>{'>'} Ready</div>
      ) : (
        displayLogs.map((log) => (
          <div key={log.id} style={{ marginBottom: '2px' }}>
            <span style={{ color: '#757575' }}>{'>'}</span>{' '}
            <span
              style={{
                color:
                  log.type === 'error'
                    ? '#dc2626'
                    : log.type === 'success'
                    ? '#10b981'
                    : log.type === 'warning'
                    ? '#f59e0b'
                    : '#424242'
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

