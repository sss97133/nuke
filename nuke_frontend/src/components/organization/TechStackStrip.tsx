/**
 * Tech stack for investor teaser page one: logos (Simple Icons) + labels.
 * CDN: https://cdn.simpleicons.org/<slug>
 */

import React from 'react';

const STACK: { slug: string; name: string }[] = [
  { slug: 'react', name: 'React' },
  { slug: 'typescript', name: 'TypeScript' },
  { slug: 'vite', name: 'Vite' },
  { slug: 'supabase', name: 'Supabase' },
  { slug: 'postgresql', name: 'PostgreSQL' },
  { slug: 'elixir', name: 'Elixir' },
  { slug: 'phoenixframework', name: 'Phoenix' },
  { slug: 'deno', name: 'Deno' },
  { slug: 'pytorch', name: 'PyTorch' },
  { slug: 'vercel', name: 'Vercel' },
];

const ICON_SIZE = 28;

export default function TechStackStrip() {
  return (
    <>
      <h3 style={{ fontSize: '11pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
        Tech stack
      </h3>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px 24px',
          alignItems: 'center',
          marginBottom: 'var(--space-6)',
          padding: '12px 0',
        }}
      >
        {STACK.map(({ slug, name }) => (
          <span
            key={slug}
            title={name}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--text)',
              fontSize: '9pt',
              fontWeight: 500,
            }}
          >
            <img
              src={`https://cdn.simpleicons.org/${slug}`}
              alt=""
              width={ICON_SIZE}
              height={ICON_SIZE}
              style={{ display: 'block', flexShrink: 0 }}
            />
            <span>{name}</span>
          </span>
        ))}
      </div>
    </>
  );
}
