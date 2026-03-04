import React, { useEffect, useState } from 'react';
import '../styles/unified-design-system.css';

const TermsOfService: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/terms-of-service.md')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load terms');
        return res.text();
      })
      .then(text => {
        setContent(text);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>;
  if (error) return <div style={{ padding: '2rem', color: 'red' }}>Error: {error}</div>;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{content}</pre>
    </div>
  );
};

export default TermsOfService;
