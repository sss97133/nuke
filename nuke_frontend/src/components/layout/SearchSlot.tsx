import React, { useState, Suspense } from 'react';

const LazySearch = React.lazy(() => import('../search/AIDataIngestionSearch'));

export const SearchSlot: React.FC = () => {
  const [activated, setActivated] = useState(false);

  if (!activated) {
    return (
      <input
        type="text"
        placeholder="Search or paste URL..."
        onFocus={() => setActivated(true)}
        style={{
          width: '100%',
          padding: '6px 10px',
          fontSize: '12px',
          border: '2px inset var(--border)',
          background: 'var(--white)',
          outline: 'none',
          boxSizing: 'border-box',
          height: '28px'
        }}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <input
          type="text"
          placeholder="Loading..."
          disabled
          style={{
            width: '100%',
            padding: '6px 10px',
            fontSize: '12px',
            border: '2px inset var(--border)',
            background: 'var(--white)',
            outline: 'none',
            boxSizing: 'border-box',
            height: '28px',
            opacity: 0.6
          }}
        />
      }
    >
      <LazySearch />
    </Suspense>
  );
};
