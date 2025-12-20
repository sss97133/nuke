import React from 'react';
import { usePageTitle } from '../hooks/usePageTitle';

const MarketMovement: React.FC = () => {
  usePageTitle('Market Movement');

  return (
    <div style={{ padding: '16px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '16px' }}>Market Movement</h1>
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--border)',
        padding: '16px',
        fontSize: '9pt'
      }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>
          This page is under construction. Market movement analytics and trends will be displayed here.
        </p>
        <p style={{ color: 'var(--text-muted)' }}>
          Coming soon: Price trends, sales volume analytics, market segments, and more.
        </p>
      </div>
    </div>
  );
};

export default MarketMovement;

