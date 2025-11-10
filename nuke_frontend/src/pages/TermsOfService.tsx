import React, { useEffect, useState } from 'react';
import '../design-system.css';

const TermsOfService: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/TERMS_OF_SERVICE.md')
      .then((res) => res.text())
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load terms of service:', err);
        setContent('# Terms of Service\n\nFailed to load terms. Please contact legal@n-zero.dev');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div style={{ padding: 'var(--space-6)', textAlign: 'center', fontSize: '8pt' }}>Loading terms…</div>;
  }

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ background: 'var(--white)', border: '2px solid var(--border-medium)', padding: 'var(--space-4)' }}>
        <pre style={{ fontFamily: 'Arial, sans-serif', fontSize: '8pt', whiteSpace: 'pre-wrap', lineHeight: 1.4, margin: 0 }}>{content}</pre>
      </div>
    </div>
  );
};

export default TermsOfService;

