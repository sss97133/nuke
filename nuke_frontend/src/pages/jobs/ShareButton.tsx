/**
 * ShareButton — copies a page's canonical nuke.ag URL, or opens the phone's share sheet where the browser has one.
 * The URL is the bare path: no query string, no referrer or tracking parameters, nothing about the person sharing.
 */
import React, { useState } from 'react';
import { Text } from '../../kit';
import { canonicalUrl } from '../../lib/discoveryFace';
import './jobs.css';

const prefersShareSheet = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  && typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

export default function ShareButton({ path, title, label }: { path: string; title: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const url = canonicalUrl(path);
  const share = async () => {
    if (prefersShareSheet()) {
      try { await navigator.share({ title, url }); return; } catch { /* dismissed: fall back to copying */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('manual');
    }
  };
  return <span className="jb-share">
    <button type="button" className="btn-base btn-xs btn-secondary" onClick={() => void share()} aria-label={label}>
      <Text role="label">{state === 'copied' ? 'Link copied' : label}</Text>
    </button>
    {state === 'manual' && <input className="jb-input jb-share__url k-caption" readOnly value={url} aria-label="Link to copy" onFocus={e => e.currentTarget.select()} />}
  </span>;
}
