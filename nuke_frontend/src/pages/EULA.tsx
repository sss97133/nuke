import React, { useEffect, useState } from 'react';
import '../design-system.css';

const EULA: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/EULA.md')
      .then((res) => res.text())
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load EULA:', err);
        setContent('# End-User License Agreement\n\nFailed to load EULA. Please contact legal@n-zero.dev');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div style={{ padding: 'var(--space-6)', textAlign: 'center', fontSize: '8pt' }}>Loading EULA…</div>;
  }

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ background: 'var(--white)', border: '2px solid var(--border-medium)', padding: 'var(--space-4)' }}>
        <pre style={{ fontFamily: 'Arial, sans-serif', fontSize: '8pt', whiteSpace: 'pre-wrap', lineHeight: 1.4, margin: 0 }}>{content}</pre>
      </div>
    </div>
  );
};

export default EULA;
