import React, { useState, useEffect } from 'react';
import '../design-system.css';

export default function Legal() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch LEGAL.md content
    fetch('/LEGAL.md')
      .then(res => res.text())
      .then(text => {
        setContent(text);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load legal terms:', err);
        setContent('# Legal Terms\n\nFailed to load legal terms. Please contact support.');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center', fontSize: '8pt' }}>
        Loading legal terms...
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{
        background: 'var(--white)',
        border: '2px solid var(--border-medium)',
        padding: 'var(--space-4)'
      }}>
        <pre style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: '8pt',
          whiteSpace: 'pre-wrap',
          lineHeight: '1.4',
          margin: 0
        }}>
          {content}
        </pre>
      </div>
      
      <div style={{
        marginTop: 'var(--space-4)',
        textAlign: 'center',
        fontSize: '8pt'
      }}>
        <a href="/market" style={{ color: 'var(--text)', textDecoration: 'underline' }}>
          ← Back to Market
        </a>
      </div>
    </div>
  );
}

