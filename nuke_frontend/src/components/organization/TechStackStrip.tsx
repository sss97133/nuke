/**
 * Tech stack for investor teaser: logo + name. Uses Simple Icons via jsDelivr (reliable).
 * Slugs: https://github.com/simple-icons/simple-icons/tree/develop/icons
 */

import React, { useState } from 'react';

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
const LOGO_BASE = 'https://cdn.jsdelivr.net/npm/simple-icons@11/icons';

function TechLogo({ slug, name }: { slug: string; name: string }) {
  const [errored, setErrored] = useState(false);
  const src = `${LOGO_BASE}/${slug}.svg`;
  if (errored) {
    return (
      <span
        title={name}
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--text)',
          width: ICON_SIZE,
          height: ICON_SIZE,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {name.slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={ICON_SIZE}
      height={ICON_SIZE}
      title={name}
      onError={() => setErrored(true)}
      style={{
        display: 'block',
        width: ICON_SIZE,
        height: ICON_SIZE,
        objectFit: 'contain',
        filter: 'brightness(0)',
      }}
    />
  );
}

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
              justifyContent: 'center',
              width: ICON_SIZE,
              height: ICON_SIZE,
              color: 'var(--text)',
            }}
          >
            <TechLogo slug={slug} name={name} />
          </span>
        ))}
      </div>
    </>
  );
}
