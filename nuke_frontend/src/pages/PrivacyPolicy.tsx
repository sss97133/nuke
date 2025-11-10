import React, { useEffect, useState } from 'react';
import '../design-system.css';

const PrivacyPolicy: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/PRIVACY_POLICY.md')
      .then((res) => res.text())
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load privacy policy:', err);
        setContent('# Privacy Policy\n\nFailed to load privacy policy. Please contact privacy@n-zero.dev');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div style={{ padding: 'var(--space-6)', textAlign: 'center', fontSize: '8pt' }}>Loading privacy policy…</div>;
  }

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ background: 'var(--white)', border: '2px solid var(--border-medium)', padding: 'var(--space-4)' }}>
        <pre style={{ fontFamily: 'Arial, sans-serif', fontSize: '8pt', whiteSpace: 'pre-wrap', lineHeight: 1.4, margin: 0 }}>{content}</pre>
      </div>
    </div>
  );
};

export default PrivacyPolicy;

